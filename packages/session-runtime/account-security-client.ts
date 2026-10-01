import type { AccountSecurity, AccountAction } from '../contracts/account-security.ts';
type Request = <T>(path: string, method?: string, data?: unknown) => Promise<T>;
export interface SecurityState { data: AccountSecurity | null; busy: boolean; error: string; outcome: 'password' | 'signout' | 'uncertain' | 'signin' | null }
export class AccountSecurityClient {
  state: SecurityState = { data: null, busy: false, error: '', outcome: null };
  private disposed = false;
  private familyId: string; private request: Request; private changed: (state: SecurityState) => void;
  constructor(familyId: string, request: Request, changed: (state: SecurityState) => void) { this.familyId = familyId; this.request = request; this.changed = changed; }
  private update(value: Partial<SecurityState>) { if (!this.disposed) { this.state = { ...this.state, ...value }; this.changed(this.state); } }
  async load() {
    if (this.disposed || this.state.busy || this.state.outcome) return;
    this.update({ busy: true, error: '', data: null });
    try {
      const data = await this.request<AccountSecurity>('/account/security');
      if (data.version !== 'account-security-1' || data.familyId !== this.familyId) throw new Error('ACCOUNT_UPDATE_REQUIRED');
      this.update({ data });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'LOAD_FAILED';
      this.update({ error: code, outcome: ['UNAUTHENTICATED', 'PARENT_REQUIRED'].includes(code) ? 'signin' : null });
    } finally { this.update({ busy: false }); }
  }
  async submit(action: AccountAction, input: { currentPassword: string; newPassword?: string; acknowledged: true }) {
    if (this.disposed || this.state.busy || !this.state.data || this.state.outcome) return;
    this.update({ busy: true, error: '' });
    try {
      const result = await this.request<{ ok: boolean; signInRequired: boolean }>(action === 'password' ? '/auth/change-password' : '/auth/logout-all', 'POST', input);
      if (!result.ok || !result.signInRequired) throw new Error('Unconfirmed account result');
      this.update({ data: null, outcome: action });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (['PASSWORD_REJECTED', 'ACCOUNT_LOCKED', 'PASSWORD_UNCHANGED', 'INVALID_REQUEST'].includes(code ?? '')) this.update({ error: code });
      else this.update({ data: null, error: code ?? 'RESULT_UNCONFIRMED', outcome: ['UNAUTHENTICATED', 'PARENT_REQUIRED'].includes(code ?? '') ? 'signin' : 'uncertain' });
    } finally { this.update({ busy: false }); }
  }
  dispose() { this.disposed = true; }
}
