import { replay } from '../task-engine/index.ts';
import type { Action, EngineEvent, Plan, Replay } from '../task-engine/index.ts';

/** Evaluate a command batch in order, including transitions within the batch. */
export function appendObservations(plan: Plan, events: EngineEvent[], actions: Action[], observedAt: number, uuid: () => string, budgetMs = Infinity) {
  const updated = [...events];
  let state: Replay = replay(plan, updated, budgetMs);
  const at = Math.max(observedAt, events.at(-1)?.at ?? 0);
  for (const action of actions) {
    if (state.ended) break;
    // Timers and lifecycle callbacks may arrive after an earlier command closed a trial.
    if (!state.active && ['interrupt', 'choose', 'submit', 'undo', 'help', 'encode_end'].includes(action.type)) continue;
    if (updated.length >= 3000) throw new Error('Session event limit reached');
    updated.push({ ...action, at, id: uuid(), seq: updated.length + 1 } as EngineEvent);
    state = replay(plan, updated, budgetMs);
  }
  return { events: updated, state };
}
