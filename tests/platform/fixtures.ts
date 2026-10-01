import { randomUUID } from 'node:crypto';
import type { Plan, Action, EngineEvent } from '../../packages/task-engine/index.ts';
export function completeEvents(plan: Plan, options: { idle?: boolean; help?: boolean } = {}): EngineEvent[] {
  const events: EngineEvent[] = []; let at = 0;
  const add = (action: Action, wait = 100) => { at += wait; events.push({ ...action, ...(action.type === 'choose' && plan.version === '2.0.0' ? { input: plan.environment!.input } : {}), id: randomUUID(), seq: events.length + 1, at }); };
  for (const trial of plan.trials) {
    add({ type: 'present', trialId: trial.id, ...(plan.version === '2.0.0' ? { presentation: { frameDeltaMs: 16, assetsReady: true, method: plan.environment?.platform === 'web' ? 'raf-pair' as const : 'native-frame' as const } } : {}) }, 1001);
    const onset = at;
    if (options.help && !trial.practice) add({ type: 'help' });
    if (trial.task === 'memory') {
      add({ type: 'encode_end' }, 500);
      for (const item of trial.sequence) add({ type: 'choose', index: trial.items.indexOf(item) });
    } else if (trial.task === 'search') {
      for (const [index, item] of trial.items.entries()) if (item === trial.target) add({ type: 'choose', index });
    } else if (trial.go && (!options.idle || trial.practice)) add({ type: 'choose', index: 0 });
    add({ type: 'submit' }, trial.windowMs ? trial.windowMs - (at - onset) + 5 : 100);
  }
  add({ type: 'end', reason: 'completed' }); return events;
}
