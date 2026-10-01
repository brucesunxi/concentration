import type { PracticeLimits } from '../contracts/practice-limits.ts';
type Request = <T>(path: string, method?: string, data?: unknown, headers?: Record<string, string>) => Promise<T>;
export interface LimitState { data: PracticeLimits | null; busy: boolean; error: string; saved: boolean; needsParent: boolean }
export class PracticeLimitClient {
  state: LimitState = { data: null, busy: false, error: '', saved: false, needsParent: false };
  private disposed = false;
  private childId: string; private parent: boolean; private request: Request; private changed: (state: LimitState) => void;
  constructor(childId: string, parent: boolean, request: Request, changed: (state: LimitState) => void) { this.childId = childId; this.parent = parent; this.request = request; this.changed = changed; }
  private update(value: Partial<LimitState>) { if (!this.disposed) { this.state = { ...this.state, ...value }; this.changed(this.state); } }
  private check(value: PracticeLimits) {
    if (value?.version !== 'practice-limits-1' || value.childId !== this.childId || value.canEdit !== this.parent || !Number.isInteger(value.settingsVersion)) throw new Error('Unexpected practice settings');
    return value;
  }
  async load() {
    if (this.disposed || this.state.busy) return;
    this.update({ data: null, busy: true, error: '', saved: false, needsParent: false });
    try { this.update({ data: this.check(await this.request<PracticeLimits>(`/children/${this.childId}/practice-limits`)) }); }
    catch (error) { const code = (error as { code?: string }).code ?? 'LOAD_FAILED'; this.update({ error: code, needsParent: ['UNAUTHENTICATED', 'PARENT_REQUIRED', 'REAUTH_REQUIRED'].includes(code) }); }
    finally { this.update({ busy: false }); }
  }
  async save(minutes: number) {
    const current = this.state.data;
    if (this.disposed || this.state.busy || !current?.canEdit || !current.collectionActive) return;
    this.update({ busy: true, error: '', saved: false });
    try {
      const next = await this.request<PracticeLimits>(`/children/${this.childId}/practice-limits`, 'PATCH', { minutes, effectiveDay: current.nextDay, acknowledged: true }, { 'If-Match': `"${current.settingsVersion}"` });
      this.update({ data: this.check(next), saved: true });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'RESULT_UNCONFIRMED';
      this.update({ data: null, error: code, needsParent: ['UNAUTHENTICATED', 'PARENT_REQUIRED', 'REAUTH_REQUIRED'].includes(code) });
    } finally { this.update({ busy: false }); }
  }
  dispose() { this.disposed = true; }
}
