import { z } from 'zod';
import { canonical, hashObject, trustedKeySchema } from '../content/index.ts';
import type { ContentVerifier } from '../content/index.ts';
import type { Plan, Action } from '../task-engine/index.ts';
import { practiceWindowPolicy, practiceWindowSchema } from './practice-window.ts';

export const MAX_CONTINUATION_MS = 24 * 60 * 60 * 1000;
export const MAX_UPLOAD_MS = 7 * MAX_CONTINUATION_MS;
export const authoritySchema = z.object({ id: z.string().min(1).max(120), purpose: z.literal('session-continuation'), jwk: trustedKeySchema.shape.jwk }).strict();
export type SessionAuthority = z.infer<typeof authoritySchema>;
const grantBodyFields = {
    kind: z.literal('focus-session-continuation'), mode: z.literal('local-development'),
    sessionId: z.string().uuid(), childId: z.string().uuid(), deviceId: z.string().uuid(), planHash: z.string().regex(/^[a-f0-9]{64}$/),
    transport: z.enum(['web', 'native']), maxActiveMs: z.number().int().min(1).max(720000), maxEvents: z.literal(3000),
    issuedAt: z.iso.datetime(), recordUntil: z.iso.datetime(), uploadUntil: z.iso.datetime(),
};
export const grantSchema = z.object({
  body: z.discriminatedUnion('version', [
    z.object({ ...grantBodyFields, version: z.literal(1) }).strict(),
    z.object({ ...grantBodyFields, version: z.literal(2), windowPolicy: practiceWindowSchema }).strict(),
  ]),
  signature: z.object({ keyId: z.string().min(1).max(120), value: z.string().regex(/^[a-f0-9]{128}$/) }).strict(),
}).strict().superRefine(({ body }, ctx) => {
  const issued = Date.parse(body.issuedAt), record = Date.parse(body.recordUntil), upload = Date.parse(body.uploadUntil);
  if (record <= issued || record - issued > MAX_CONTINUATION_MS || upload < record || upload - issued > MAX_UPLOAD_MS) ctx.addIssue({ code: 'custom', message: 'Invalid continuation interval' });
  if (body.version === 2 && (record - issued > body.windowPolicy.maxElapsedMs || body.windowPolicy.checkInAfterMs >= body.windowPolicy.maxElapsedMs)) ctx.addIssue({ code: 'custom', message: 'Invalid practice window' });
});
export type ContinuationGrant = z.infer<typeof grantSchema>;
export class AuthorizationError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
const check = (condition: unknown, code: string) => { if (!condition) throw new AuthorizationError(code); };

export async function verifyGrant(raw: unknown, authorities: SessionAuthority[], expected: { sessionId: string; childId: string; deviceId: string; plan: Plan; budgetMs: number; transport: 'web' | 'native' }, verifier?: ContentVerifier) {
  const grant = grantSchema.parse(raw), { body, signature } = grant;
  const identity = authorities.find(key => key.id === signature.keyId);
  check(identity, 'UNKNOWN_SESSION_AUTHORITY'); authoritySchema.parse(identity);
  const bytes = new TextEncoder().encode(canonical(body)), signatureBytes = Uint8Array.from(signature.value.match(/../g)!.map(value => parseInt(value, 16)));
  const valid = verifier ? await verifier.verifyP256(bytes, signatureBytes, identity!.jwk) : await (async () => {
    const key = await crypto.subtle.importKey('jwk', identity!.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, bytes);
  })();
  check(valid, 'INVALID_SESSION_SIGNATURE');
  check(body.sessionId === expected.sessionId && body.childId === expected.childId && body.deviceId === expected.deviceId && body.transport === expected.transport, 'SESSION_DEVICE_MISMATCH');
  check(expected.plan.id === expected.sessionId && body.maxActiveMs === expected.budgetMs && body.planHash === await hashObject(expected.plan, verifier), 'SESSION_PLAN_MISMATCH');
  check(expected.plan.content && Date.parse(body.recordUntil) > Date.parse(body.issuedAt), 'SESSION_PLAN_MISMATCH');
  if (body.version === 2) check(canonical(body.windowPolicy) === canonical(practiceWindowPolicy(expected.plan.ageBand)), 'SESSION_WINDOW_POLICY_MISMATCH');
  return grant;
}

export interface ClockCheckpoint { highest: number; fault: string | null }
/** A local checkpoint detects ordinary rollback; it is not trusted hardware time. */
export class ContinuationClock {
  private wall: () => number;
  private mono: () => number;
  private anchorWall: number;
  private anchorMono: number;
  private highest: number;
  private fault: string | null = null;
  readonly grant: ContinuationGrant;
  constructor(grant: ContinuationGrant, wall: () => number = Date.now, mono: () => number = () => performance.now(), checkpoint?: ClockCheckpoint) {
    this.grant = grant; this.wall = wall; this.mono = mono;
    this.anchorWall = wall(); this.anchorMono = mono(); this.highest = Number.isFinite(this.anchorWall) ? this.anchorWall : Date.parse(grant.body.issuedAt);
    if (!Number.isFinite(this.anchorWall) || !Number.isFinite(this.anchorMono) || this.anchorWall < Date.parse(grant.body.issuedAt) - 60000) this.fault = 'SESSION_CLOCK_CHANGED';
    if (checkpoint) {
      if (!Number.isFinite(checkpoint.highest) || this.anchorWall < checkpoint.highest - 1000) this.fault = 'SESSION_CLOCK_CHANGED';
      if (Number.isFinite(checkpoint.highest)) this.highest = Math.max(this.highest, checkpoint.highest);
      if (checkpoint.fault) this.fault = checkpoint.fault;
    }
  }
  block(code: string) { this.fault = code; }
  private time() {
    const wall = this.wall(), mono = this.mono();
    if (!Number.isFinite(wall) || !Number.isFinite(mono)) { this.fault ??= 'SESSION_CLOCK_CHANGED'; throw new AuthorizationError(this.fault); }
    if (mono < this.anchorMono || wall < this.highest - 1000) this.fault ??= 'SESSION_CLOCK_CHANGED';
    const current = Math.max(wall, this.anchorWall + Math.max(0, mono - this.anchorMono));
    this.highest = Math.max(this.highest, current);
    if (this.fault) throw new AuthorizationError(this.fault);
    return this.highest;
  }
  remaining() { return Math.max(0, Date.parse(this.grant.body.recordUntil) - this.time()); }
  elapsed() { return Math.max(0, this.time() - Date.parse(this.grant.body.issuedAt)); }
  checkpoint(): ClockCheckpoint {
    try { this.time(); } catch { /* Preserve the fault as well as the last finite timestamp. */ }
    return { highest: Number.isFinite(this.highest) ? this.highest : Date.parse(this.grant.body.issuedAt), fault: this.fault };
  }
  assert(actions: Action[]) {
    // Closing and interruption preserve the existing attempt after its recording window.
    // They never authorize a new presentation, answer, or scored submission.
    const closure = actions.every(action => action.type === 'interrupt' || action.type === 'end');
    if (closure) return;
    check(this.remaining() > 0, 'SESSION_AUTHORIZATION_EXPIRED');
  }
}
