import { z } from 'zod';
import { verifyRelease, hashObject, releaseSchema, trustedKeySchema } from '../content/index.ts';
import type { Release, TrustedKey, ContentVerifier } from '../content/index.ts';
import { authoritySchema, grantSchema, verifyGrant, ContinuationClock } from './authorization.ts';
import type { ClockCheckpoint } from './authorization.ts';
import type { AuthorizationProof } from './prepare-authorization.ts';
import type { Session } from '../contracts/models.ts';
import { eventSchema } from '../contracts/index.ts';
import { replay } from '../task-engine/index.ts';
import type { Plan } from '../task-engine/index.ts';

export interface ContentProof { release: Release; keys: TrustedKey[] }
const checkpointSchema = z.object({ highest: z.number().finite().nonnegative(), fault: z.string().max(100).nullable() }).strict();
const sessionSchema = z.object({
  id: z.string().uuid(), child_id: z.string().uuid(), plan: z.custom<Plan>(value => !!value && typeof value === 'object' && !Array.isArray(value)),
  budget_ms: z.number().int().min(1).max(720000), state: z.literal('active'), created_at: z.string(), continuation_grant: grantSchema,
}).strict();
export const offlineCapsuleSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal('local-development'), familyId: z.string().uuid(), deviceId: z.string().uuid(),
  session: sessionSchema, authorities: z.array(authoritySchema).min(1).max(100), content: z.object({ release: releaseSchema, keys: z.array(trustedKeySchema).min(1).max(100) }).strict(),
}).strict();
export type OfflineCapsule = z.infer<typeof offlineCapsuleSchema>;
export interface OfflineSaved { capsule: OfflineCapsule; checkpoint: ClockCheckpoint; journalHash: string }
export class OfflineError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
export class OfflinePreparationChanged extends Error { constructor() { super('OFFLINE_PREPARATION_CHANGED'); } }
export class NetworkUnavailable extends Error { constructor() { super('NETWORK_UNAVAILABLE'); } }
export const isNetworkFailure = (error: unknown) => error instanceof NetworkUnavailable;

export function makeOfflineCapsule(familyId: string, deviceId: string, session: Session, authorization: AuthorizationProof, content: ContentProof): OfflineCapsule {
  if (!authorization.status.canContinue || authorization.status.historyOnly || authorization.status.state !== 'active' || authorization.status.id !== session.id) throw new OfflineError('OFFLINE_NOT_AUTHORIZED');
  return offlineCapsuleSchema.parse({schemaVersion:1,mode:'local-development',familyId,deviceId,session:{
    id:session.id,child_id:session.child_id,plan:session.plan,budget_ms:session.budget_ms,state:'active',created_at:session.created_at,continuation_grant:session.continuation_grant,
  },authorities:authorization.authorities,content});
}

export async function verifyOfflineSession(saved: OfflineSaved, deviceId: string, platform: 'web'|'ios'|'android', journal: unknown[], verifier?: ContentVerifier, wall:()=>number=Date.now, mono:()=>number=()=>performance.now()) {
  const capsule = offlineCapsuleSchema.parse(saved.capsule), checkpoint = checkpointSchema.parse(saved.checkpoint), session=capsule.session,plan=session.plan;
  if (capsule.deviceId!==deviceId || plan.environment?.platform!==platform) throw new OfflineError('OFFLINE_DEVICE_MISMATCH');
  const grant=await verifyGrant(session.continuation_grant,capsule.authorities,{sessionId:session.id,childId:session.child_id,deviceId,plan,budgetMs:session.budget_ms,transport:platform==='web'?'web':'native'},verifier);
  const clock=new ContinuationClock(grant,wall,mono,checkpoint);
  if (clock.remaining()<=0) throw new OfflineError('SESSION_AUTHORIZATION_EXPIRED');
  if (!/^[a-f0-9]{64}$/.test(saved.journalHash) || await hashObject(journal,verifier)!==saved.journalHash) throw new OfflineError('OFFLINE_JOURNAL_CHANGED');
  if(journal.length>grant.body.maxEvents)throw new OfflineError('OFFLINE_JOURNAL_CHANGED');
  replay(plan,journal.map(event=>eventSchema.parse(event)),session.budget_ms);
  const pack=await verifyRelease(capsule.content.release,capsule.content.keys,{mode:'local',market:'LOCAL',now:wall(),verifier});
  if (!plan.content || capsule.content.release.body.packHash!==plan.content.sha256 || pack.id!==plan.content.id || pack.version!==plan.content.version || pack.task!==plan.task || pack.ageBand!==plan.ageBand || pack.locale!==plan.locale || pack.engineVersion!==plan.version || pack.policyVersion!==plan.policyVersion) throw new OfflineError('OFFLINE_CONTENT_MISMATCH');
  // The journal is loaded separately and must remain authoritative; never duplicate private events in the capsule.
  return {capsule,clock,pack};
}
