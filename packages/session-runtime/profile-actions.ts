import { isNetworkFailure } from './offline-session.ts';

export type ProfileAction = 'export' | 'withdraw' | 'delete';
export type ExportDelivery = 'saved' | 'share-sheet-closed' | 'cancelled';
export interface ParentIdentity { role: string; family: { id: string }; member?: { role: string; state: string }; children: { id: string; collectionStatus?: string }[] }
export interface ProfileActionPorts {
  authenticate(): Promise<ParentIdentity>;
  identity(): Promise<ParentIdentity>;
  current(): boolean;
  request(path: string, method: string): Promise<unknown>;
  cleanup(): Promise<void>;
  share(data: unknown): Promise<ExportDelivery>;
}
export function requireCurrent(current: () => boolean) {
  if (!current()) throw new Error('ACTION_INTERRUPTED');
}
function assertParent(identity: ParentIdentity, familyId: string) {
  if (identity.role !== 'parent' || identity.family.id !== familyId) throw new Error('PARENT_IDENTITY_CHANGED');
  if (identity.member?.role !== 'owner' || identity.member.state !== 'active') throw new Error('PARENT_SCOPE_INCOMPLETE');
}
function mutationMayNeedVerification(error: unknown) {
  const response = error as { code?: unknown; status?: unknown } | null;
  return isNetworkFailure(error) || response?.code === 'NOT_FOUND' || response?.code === 'RESPONSE_UNREADABLE' || response?.status === 404 || (typeof response?.status === 'number' && response.status >= 500);
}
export async function performProfileAction(action: ProfileAction, familyId: string, childId: string, ports: ProfileActionPorts) {
  const me = await ports.authenticate(); requireCurrent(ports.current); assertParent(me, familyId);
  // A missing profile after reauthentication can confirm a prior deletion whose receipt was lost.
  const exists = me.children.some(child => child.id === childId);
  if (!exists && action !== 'delete') throw new Error('PROFILE_UNAVAILABLE');
  if (action === 'export') {
    const data = await ports.request(`/children/${childId}/export`, 'GET'); requireCurrent(ports.current);
    const delivery = await ports.share(data);
    return { action, serverConfirmed: true, localCleared: false, delivery };
  }
  if (exists) {
    try { await ports.request(`/children/${childId}${action === 'withdraw' ? '/withdraw' : ''}`, action === 'withdraw' ? 'POST' : 'DELETE'); }
    catch (error) {
      if (!mutationMayNeedVerification(error)) throw error;
      requireCurrent(ports.current);
      let current: ParentIdentity;
      try { current = await ports.identity(); }
      catch { throw error; }
      requireCurrent(ports.current); assertParent(current, familyId);
      const profile = current.children.find(child => child.id === childId);
      if (action === 'delete' ? !!profile : profile?.collectionStatus !== 'collection-withdrawn') throw error;
    }
  }
  // A confirmed server mutation must still clean up even if the parent screen has closed.
  let localCleared = false;
  try { await ports.cleanup(); localCleared = true; } catch { /* caller presents a cleanup retry, never a full-success claim */ }
  return { action, serverConfirmed: true, localCleared, delivery: undefined };
}

export function serializeChildExport(data: unknown, childId: string) {
  const value = data as { schemaVersion?: number; child?: { id?: string }; sessions?: unknown; events?: unknown; observations?: unknown; confirmations?: unknown; verifiedConsents?: unknown } | null;
  if (!value || ![1,2].includes(value.schemaVersion ?? 0) || value.child?.id !== childId ||
    ![value.sessions,value.events,value.observations,value.confirmations].every(Array.isArray) ||
    (value.schemaVersion === 2 && !Array.isArray(value.verifiedConsents))) throw new Error('EXPORT_FORMAT_INVALID');
  const forbidden = new Set(['password_hash','token_hash','accessToken','csrf','request_key','request_hash','device_id']);
  const text = JSON.stringify(value, (key, entry) => { if (forbidden.has(key)) throw new Error('EXPORT_CONTAINS_PRIVATE_CREDENTIALS'); return entry; }, 2);
  if (text.length > 10_000_000) throw new Error('EXPORT_TOO_LARGE');
  return text;
}
