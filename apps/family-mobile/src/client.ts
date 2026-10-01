import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { Platform, Dimensions } from 'react-native';
import { fetch } from 'expo/fetch';
import type { Session, Me, Child } from '../../../packages/contracts/models.ts';
import type { TaskId } from '../../../packages/task-engine/index.ts';
import { invalidateOffline } from './storage';
import { NetworkUnavailable } from '../../../packages/session-runtime/offline-session.ts';
import { CredentialInterrupted, CredentialStore } from '../../../packages/session-runtime/credential-store.ts';
import type { AccountAction } from '../../../packages/contracts/account-security.ts';

// Simulator/adb reverse only. Production routing must come from approved regional configuration.
export const API_ORIGIN = 'http://localhost:4181';
const CHILD_TOKEN = 'focus.local.child-token.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export class MobileRequestError extends Error {
  code: string; status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
export class MobileClient {
  private token: string | null = null;
  private role: 'parent' | 'child' | null = null;
  private authEpoch = 0;
  private installation: Promise<string> | null = null;
  private saved = new CredentialStore({ set: value => SecureStore.setItemAsync(CHILD_TOKEN, value, options), remove: () => SecureStore.deleteItemAsync(CHILD_TOKEN, options) });
  async restore() {
    const epoch = ++this.authEpoch;
    const saved = await SecureStore.getItemAsync(CHILD_TOKEN, options);
    if (epoch !== this.authEpoch) throw new CredentialInterrupted();
    this.token = saved && /^[a-f0-9]{64}$/.test(saved) ? saved : null; this.role = this.token ? 'child' : null;
  }
  async request<T>(path: string, method = 'GET', data?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(API_ORIGIN + '/api' + path, { method, credentials: 'omit', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Focus-Client': 'native-local-v1', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }).catch(() => { throw new NetworkUnavailable(); });
      const body = await response.json();
      if (!response.ok) throw new MobileRequestError(body.code ?? 'REQUEST_FAILED', response.status);
      return body as T;
    } finally { clearTimeout(timer); }
  }
  private async parentAuth(path: string, data: unknown) {
    const epoch = ++this.authEpoch;
    await invalidateOffline(); if(epoch !== this.authEpoch)throw new CredentialInterrupted();
    const auth = await this.request<{ accessToken: string }>(path, 'POST', data);
    if (!/^[a-f0-9]{64}$/.test(auth.accessToken)) throw new Error('Invalid auth response');
    const current = () => {
      if (epoch === this.authEpoch) return;
      void this.request('/auth/logout', 'POST', {}, { Authorization: `Bearer ${auth.accessToken}` }).catch(() => undefined);
      throw new MobileRequestError('AUTH_INTERRUPTED', 409);
    };
    current(); await this.saved.update(null, () => epoch === this.authEpoch); current();
    this.token = auth.accessToken; this.role = 'parent';
    const me = await this.request<Me>('/me'); current(); return me;
  }
  login(name: string, password: string, memberLogin = 'owner') { return this.parentAuth('/auth/login', { name, password, memberLogin }); }
  join(data:unknown) { return this.parentAuth('/auth/join',data); }
  setup(name: string, password: string, locale: 'zh-CN' | 'en') {
    return this.parentAuth('/auth/setup', { name, password, locale, residenceCountry: 'ZZ', registrationPlatform: Platform.OS, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', acknowledgedLocalUse: true });
  }
  async start(childId: string, task: TaskId) {
    const epoch = ++this.authEpoch;
    await invalidateOffline();
    const deviceId = await this.deviceId();
    if (epoch !== this.authEpoch) throw new CredentialInterrupted();
    const environment = { platform: Platform.OS, deviceClass: Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height) >= 600 ? 'tablet' : 'phone', input: 'touch', modality: 'visual' };
    if (!['ios', 'android'].includes(environment.platform)) throw new Error('Native client only');
    const response = await this.request<Session & { accessToken: string }>(`/children/${childId}/sessions`, 'POST', { task, deviceId, environment }, { 'Idempotency-Key': randomUUID() });
    const { accessToken, ...session } = response;
    await this.keepChild(accessToken, epoch); return session;
  }
  async recover(childId: string, sessionId: string) {
    const epoch = ++this.authEpoch; await invalidateOffline(); const deviceId = await this.deviceId();
    if (epoch !== this.authEpoch) throw new CredentialInterrupted();
    const { accessToken, ...session } = await this.request<Session & {accessToken:string}>(`/children/${childId}/recovery/${sessionId}/resume`, 'POST', {deviceId});
    await this.keepChild(accessToken, epoch); return session;
  }
  async deviceId() {
    // Overview loading and starting practice may overlap on the first installation.
    // They must share one secure-store initialization and one installation identity.
    this.installation ??= (async () => {
      let value = await SecureStore.getItemAsync('focus.local.device-id.v1', options);
      if (!value) { value = randomUUID(); await SecureStore.setItemAsync('focus.local.device-id.v1', value, options); }
      if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error('Device identity is unavailable');
      return value;
    })();
    try { return await this.installation; }
    catch (error) { this.installation = null; throw error; }
  }
  async enterChild(childId: string) {
    const epoch = ++this.authEpoch;
    await invalidateOffline(); if(epoch !== this.authEpoch)throw new CredentialInterrupted();
    const { accessToken, child } = await this.request<{ accessToken: string; child: Child }>(`/children/${childId}/enter`, 'POST', {});
    await this.keepChild(accessToken, epoch); return child;
  }
  private async keepChild(accessToken: string, epoch: number) {
    if (!/^[a-f0-9]{64}$/.test(accessToken)) throw new Error('Invalid auth response');
    if (epoch !== this.authEpoch) {
      void this.request('/auth/logout', 'POST', {}, { Authorization: `Bearer ${accessToken}` }).catch(() => undefined);
      throw new CredentialInterrupted();
    }
    // The old parent token has already been revoked by the service.
    this.token = null; this.role = null;
    try { await this.saved.update(accessToken, () => epoch === this.authEpoch); }
    catch (error) {
      void this.request('/auth/logout', 'POST', {}, { Authorization: `Bearer ${accessToken}` }).catch(() => undefined);
      throw error;
    }
    this.token = accessToken; this.role = 'child';
  }
  async logout() {
    this.authEpoch++;
    const token = this.token; this.token = null; this.role = null;
    const erased = this.saved.update(null);
    void erased.catch(() => undefined);
    try { await invalidateOffline(); if (token) await this.request('/auth/logout', 'POST', {}, { Authorization: `Bearer ${token}` }); }
    finally { await erased; }
  }
  async accountAction<T>(action: AccountAction, data: unknown): Promise<T> {
    const epoch = ++this.authEpoch;
    let forget = false;
    try {
      const result = await this.request<T>(action === 'password' ? '/auth/change-password' : '/auth/logout-all', 'POST', data);
      forget = true; return result;
    } catch (error) {
      // Unknown outcomes must not leave this installation using an old credential.
      forget = !(error instanceof MobileRequestError && ['PASSWORD_REJECTED', 'ACCOUNT_LOCKED', 'PASSWORD_UNCHANGED', 'INVALID_REQUEST'].includes(error.code));
      throw error;
    } finally {
      if (forget && epoch === this.authEpoch) {
        this.token = null; this.role = null;
        await this.saved.update(null, () => epoch === this.authEpoch);
        if (epoch === this.authEpoch) await invalidateOffline();
      }
    }
  }
  async forgetChildAccess() {
    if(this.role !== 'child')return;
    this.authEpoch++; this.token=null; this.role=null;
    // An explicit denial must not become offline access after a later network failure.
    await this.saved.update(null);
  }
  canRestoreOffline() { return this.role === 'child' && !!this.token; }
  lockParent() {
    this.authEpoch++;
    if (this.role !== 'parent') return;
    const pending = this.request('/auth/logout', 'POST', {});
    this.token = null; this.role = null; void pending.catch(() => undefined);
  }
}
export const unavailable = (e: unknown) => e instanceof MobileRequestError && ['UNAUTHENTICATED', 'CONSENT_REVOKED', 'NOT_FOUND', 'CONTENT_RECALLED', 'CONTENT_NOT_FOUND', 'RELEASE_EXPIRED_OR_FUTURE', 'EVENT_CONFLICT', 'SESSION_DEVICE_MISMATCH', 'SESSION_UPLOAD_EXPIRED', 'MARKET_SCOPE_CHANGED'].includes(e.code);
