import type { Environment } from '../../../packages/task-engine/index.ts';
import { NetworkUnavailable } from '../../../packages/session-runtime/offline-session.ts';
import { journal } from './journal.ts';
import { validRequestReference } from '../../../packages/contracts/request-reference.ts';
export type { Child, Me, Session, Result, Report } from '../../../packages/contracts/models.ts';
export type DeletedFamily = { id: string; childIds: string[] };
export type AccountAccessOutcome = 'password' | 'signout' | 'uncertain' | 'delete-uncertain' | 'signin' | 'deleted' | 'deleted-local-pending';
export type AccountAccessEvent = { outcome: AccountAccessOutcome; deletingFamily?: DeletedFamily };
let csrf = '';
export const accessSender=crypto.randomUUID();
export function setCsrf(value: string) { csrf = value; }
function accountAccessEnded(outcome: AccountAccessOutcome, deletingFamily?: DeletedFamily) {
  csrf = '';
  window.dispatchEvent(new CustomEvent<AccountAccessEvent>('focus-account-access', { detail: { outcome, deletingFamily } }));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('focus-family-access'); channel.postMessage({ source: accessSender, reason: 'account-security', outcome, deletingFamily }); channel.close();
  }
}
export class RequestError extends Error { code: string; status: number; requestId: string | null; constructor(message: string, code: string, status: number, requestId: string | null = null) { super(message); this.code = code; this.status = status; this.requestId = requestId; } }
export async function request<T>(path: string, method = 'GET', data?: unknown, headers: Record<string, string> = {}, options?: { deletingFamily?: DeletedFamily }): Promise<T> {
  const accountChange=(method==='POST' && /^\/auth\/(change-password|logout-all)$/.test(path)) || (method==='DELETE' && path==='/family');
  const deletingFamily=method==='DELETE'&&path==='/family'?options?.deletingFamily:undefined;
  if(method==='DELETE'&&path==='/family'&&!deletingFamily)throw new Error('LOCAL_DELETION_CONTEXT_REQUIRED');
  const identityChange=accountChange||(method==='POST'&&(/^\/auth\/(login|setup|join|logout)$/.test(path)||/^\/children\/[^/]+\/(enter|sessions|withdraw)$/.test(path)||/^\/children\/[^/]+\/recovery\/[^/]+\/(resume|handover)$/.test(path)))||(method==='DELETE'&&/^\/children\/[^/]+$/.test(path));
  if(identityChange) {
    // A broken browser store must not prevent a parent from deleting records
    // on the server. The confirmed response separately reports local cleanup.
    if(deletingFamily)await journal().invalidateFamily(deletingFamily.id,deletingFamily.childIds).catch(()=>undefined);
    else await journal().invalidate();
  }
  if(method!=='GET'&&!csrf&&!/^\/auth\/(login|setup|join)$/.test(path))await request('/me');
  const signal = AbortSignal.timeout(12000);
  const res = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal }).catch(()=>{if(accountChange)accountAccessEnded(deletingFamily?'delete-uncertain':'uncertain',deletingFamily);throw new NetworkUnavailable();});
  const requestId = validRequestReference(res.headers.get('X-Request-ID'));
  const unreadable = () => { if(accountChange)accountAccessEnded(deletingFamily?'delete-uncertain':'uncertain',deletingFamily); return new RequestError('The service reply could not be confirmed.', 'RESPONSE_UNREADABLE', res.status, requestId); };
  const value = await res.json().catch(()=>{
    if (signal.aborted) { if(accountChange)accountAccessEnded(deletingFamily?'delete-uncertain':'uncertain',deletingFamily); throw new NetworkUnavailable(); }
    throw unreadable();
  });
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw unreadable();
  if(accountChange && (res.status>=500 || res.ok)) {
    if (res.ok && value?.ok && value?.signInRequired && path==='/family') {
      let outcome: 'deleted' | 'deleted-local-pending' = 'deleted';
      try { await journal().clearFamily(deletingFamily!.id,deletingFamily!.childIds); } catch { outcome = 'deleted-local-pending'; }
      accountAccessEnded(outcome,deletingFamily);
    } else accountAccessEnded(res.ok && value?.ok && value?.signInRequired ? path.endsWith('change-password') ? 'password' : 'signout' : deletingFamily ? 'delete-uncertain' : 'uncertain',deletingFamily);
  }
  if (res.status === 401 && path !== '/me' && !/^\/auth\/(login|setup|join)$/.test(path)) accountAccessEnded('signin',deletingFamily);
  if (!res.ok) throw new RequestError(typeof value?.message === 'string' ? value.message : 'Unable to complete request', typeof value?.code === 'string' ? value.code : 'REQUEST_FAILED', res.status, requestId);
  if (value?.csrf) csrf = value.csrf;
  if (identityChange && !accountChange) {
    // Cookies are shared between tabs. Invalidate cached parent screens too.
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('focus-family-access'); channel.postMessage({source:accessSender}); channel.close();
    }
  }
  return value as T;
}
export function deviceId() {
  const key = 'focus-device-id'; const old = localStorage.getItem(key);
  if (old && /^[a-f0-9-]{36}$/.test(old)) return old;
  const id = crypto.randomUUID(); localStorage.setItem(key, id); return id;
}
export async function prepareBrowserIdentity(){
  if(navigator.locks)await navigator.locks.request('focus-browser-identity',()=>deviceId());
  else deviceId();
}

export function environmentFor(input: Environment['input']): Environment {
  const coarse = matchMedia('(pointer: coarse)').matches;
  return { platform: 'web', modality: 'visual', deviceClass: coarse ? matchMedia('(min-width: 768px)').matches ? 'tablet' : 'phone' : 'desktop', input };
}
export function inputForClick(event: { detail: number; nativeEvent: unknown }): Exclude<Environment['input'], 'assistive'> {
  if (event.detail === 0) return 'keyboard';
  return (event.nativeEvent as PointerEvent).pointerType === 'touch' ? 'touch' : 'pointer';
}
