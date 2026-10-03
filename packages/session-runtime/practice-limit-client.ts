import type { PracticeLimits } from '../contracts/practice-limits.ts';
type Request = <T>(path: string, method?: string, data?: unknown, headers?: Record<string, string>) => Promise<T>;
export interface LimitState { data: PracticeLimits | null; busy: boolean; refreshing: boolean; stale: boolean; error: string; saved: boolean; needsParent: boolean }
export class PracticeLimitClient {
  state: LimitState = { data: null, busy: false, refreshing: false, stale: false, error: '', saved: false, needsParent: false };
  private disposed = false;
  private childId: string; private parent: boolean; private request: Request; private changed: (state: LimitState) => void;
  constructor(childId: string, parent: boolean, request: Request, changed: (state: LimitState) => void) { this.childId = childId; this.parent = parent; this.request = request; this.changed = changed; }
  private update(value: Partial<LimitState>) { if (!this.disposed) { this.state = { ...this.state, ...value }; this.changed(this.state); } }
  private check(value: PracticeLimits) {
    if (value?.version !== 'practice-limits-1' || value.childId !== this.childId || value.canEdit !== this.parent || !Number.isInteger(value.settingsVersion)) throw Object.assign(new Error('Unexpected practice settings'), { code: 'UNEXPECTED_PRACTICE_SETTINGS' });
    return value;
  }
  async load(preserveDraft = false) {
    if (this.disposed || this.state.busy) return;
    const previous = preserveDraft ? this.state.data : null;
    this.update({ data: previous, busy: true, refreshing: preserveDraft, stale: previous ? this.state.stale : false, error: '', saved: false, needsParent: false });
    try { this.update({ data: this.check(await this.request<PracticeLimits>(`/children/${this.childId}/practice-limits`)), stale: false }); }
    catch (error) {
      const failure = error as { code?: string; status?: number }, code = failure.code ?? 'LOAD_FAILED';
      const transient = (!failure.status && code === 'LOAD_FAILED') || (failure.status ?? 0) >= 500 || failure.status === 429;
      const retained = previous && transient ? previous : null;
      this.update({ data: retained, stale: !!retained, error: code, needsParent: ['UNAUTHENTICATED', 'PARENT_REQUIRED', 'REAUTH_REQUIRED'].includes(code) });
    }
    finally { this.update({ busy: false, refreshing: false }); }
  }
  refresh() { return this.load(true); }
  async save(minutes: number) {
    const current = this.state.data;
    if (this.disposed || this.state.busy || this.state.stale || !current?.canEdit || !current.collectionActive) return;
    this.update({ busy: true, refreshing: false, error: '', saved: false });
    try {
      const next = await this.request<PracticeLimits>(`/children/${this.childId}/practice-limits`, 'PATCH', { minutes, effectiveDay: current.nextDay, acknowledged: true }, { 'If-Match': `"${current.settingsVersion}"` });
      this.update({ data: this.check(next), saved: true });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'RESULT_UNCONFIRMED';
      this.update({ data: null, stale: false, error: code, needsParent: ['UNAUTHENTICATED', 'PARENT_REQUIRED', 'REAUTH_REQUIRED'].includes(code) });
    } finally { this.update({ busy: false }); }
  }
  dispose() { this.disposed = true; }
}
