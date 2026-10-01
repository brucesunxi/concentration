import type { ParentGuide } from './parent-guide-model.ts';
import { PARENT_GUIDE_VERSION } from './parent-guide-model.ts';
import type { LifeRequest } from './client.ts';

export interface GuideState { data: ParentGuide | null; busy: boolean; error: string }
export class ParentGuideClient {
  state: GuideState = { data: null, busy: false, error: '' };
  private disposed = false;
  readonly childId: string;
  private request: LifeRequest;
  private changed: (state: GuideState) => void;
  constructor(childId: string, request: LifeRequest, changed: (state: GuideState) => void) {
    this.childId = childId; this.request = request; this.changed = changed;
  }
  private update(patch: Partial<GuideState>) {
    if (!this.disposed) { this.state = { ...this.state, ...patch }; this.changed(this.state); }
  }
  async load() {
    if (this.disposed || this.state.busy) return;
    this.update({ busy: true, error: '' });
    try {
      const data = await this.request<ParentGuide>(`/children/${this.childId}/parent-guide`);
      if (data.childId !== this.childId) throw new Error('ACCESS_CHANGED');
      if (data.version !== PARENT_GUIDE_VERSION || !['unreviewed','approved'].includes(data.review) || data.content?.state!=='available' || !data.content.hash) throw new Error('GUIDE_UPDATE_REQUIRED');
      this.update({ data });
    } catch (error) {
      const code = (error as {code?: string})?.code ?? (error instanceof Error && ['ACCESS_CHANGED', 'GUIDE_UPDATE_REQUIRED'].includes(error.message) ? error.message : 'LOAD_FAILED');
      // A failed refresh must not keep a previously actionable family snapshot.
      this.update({ data: null, error: code });
    } finally { this.update({ busy: false }); }
  }
  dispose() { this.disposed = true; }
}
