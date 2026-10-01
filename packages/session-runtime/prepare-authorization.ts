import { hashObject } from '../content/index.ts';
import type { ContentVerifier } from '../content/index.ts';
import type { Session } from '../contracts/models.ts';
import { AuthorizationError, ContinuationClock, verifyGrant } from './authorization.ts';
import type { SessionAuthority } from './authorization.ts';

type Request = <T>(path: string) => Promise<T>;
export interface SessionStatus { id: string; state: string; canContinue: boolean; grantHash: string | null; serverTime: string; historyOnly?: boolean }
export interface AuthorizationProof { authorities: SessionAuthority[]; status: SessionStatus }
export async function prepareAuthorization(session: Session, deviceId: string, request: Request, verifier?: ContentVerifier, capture?: (proof: AuthorizationProof) => void) {
  if (!session.continuation_grant) return null;
  const [trust, status] = await Promise.all([
    request<{ mode: string; keys: SessionAuthority[] }>('/session-authorities'),
    request<SessionStatus>(`/sessions/${session.id}/status`),
  ]);
  if (trust.mode !== 'local-development') throw new AuthorizationError('SESSION_TRUST_MODE_MISMATCH');
  const grant = await verifyGrant(session.continuation_grant, trust.keys, { sessionId: session.id, childId: session.child_id, deviceId, plan: session.plan, budgetMs: session.budget_ms, transport: session.plan.environment?.platform === 'web' ? 'web' : 'native' }, verifier);
  if (status.id !== session.id || status.grantHash !== await hashObject(grant, verifier)) throw new AuthorizationError('SESSION_PLAN_MISMATCH');
  if (status.state !== 'active' && !status.historyOnly) throw new AuthorizationError('SESSION_ENDED');
  const clock = new ContinuationClock(grant);
  if (!Number.isFinite(Date.parse(status.serverTime)) || Math.abs(Date.now() - Date.parse(status.serverTime)) > 60000) clock.block('SESSION_CLOCK_CHANGED');
  if (!status.canContinue) clock.block('SESSION_AUTHORIZATION_EXPIRED');
  if (status.historyOnly) clock.block('SESSION_REPLACED');
  capture?.({ authorities: trust.keys, status });
  return clock;
}
