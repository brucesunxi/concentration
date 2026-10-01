import type { Replay, Trial } from '../task-engine/index.ts';

export interface TrialWindow {
  revision: number;
  trial: Trial;
  onset: number;
  priorActiveMs: number;
  priorInvalidations: number;
}

/** UI lifetime, separate from durable observations: never represents a saved result. */
export class TrialLifecycle {
  private generation = 0;
  private window: TrialWindow | null = null;
  get revision() { return this.generation; }
  get active() { return this.window; }
  isCurrent(revision: number) { return revision === this.generation; }
  isActive(window: TrialWindow) { return this.window === window && this.isCurrent(window.revision); }
  retire() { this.window = null; return ++this.generation; }
  begin(trial: Trial, onset: number, before: Replay): TrialWindow {
    const revision = this.retire();
    this.window = { revision, trial, onset, priorActiveMs: before.activeMs, priorInvalidations: before.invalidations.length };
    return this.window;
  }
  acceptsInput(at: number) {
    const current = this.window;
    return !!current && at >= current.onset && (!current.trial.windowMs || at - current.onset <= current.trial.windowMs);
  }
}
