import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPlan, replay, adapt, TEST_CONTENT, TEST_ENVIRONMENT, TIMING } from '../../packages/task-engine/index.ts';
import type { Action, EngineEvent, TaskId } from '../../packages/task-engine/index.ts';
import { createPlan as createLegacy, replay as replayLegacy } from '../../packages/task-engine/legacy-v1.ts';
import { completeEvents } from './fixtures.ts';
const make = (task: TaskId = 'stop') => createPlan({ id: 'v2-fixture', task, ageBand: '6-8', locale: 'zh-CN', level: 1, seed: 'quality', environment: TEST_ENVIRONMENT, content: TEST_CONTENT });
const presentation = { assetsReady: true, frameDeltaMs: 16, method: 'raf-pair' as const };
const event = <T extends Action>(action: T, seq: number, at: number): T & Pick<EngineEvent, 'id' | 'seq' | 'at'> => ({ ...action, seq, at, id: randomUUID() });

test('version one recordings keep their original scorer and early response behavior', () => {
  const plan = createLegacy({ id: 'v1', task: 'stop', ageBand: '6-8', locale: 'zh-CN', level: 1, seed: 'frozen' });
  const events = [event({ type: 'present', trialId: plan.trials[0].id }, 1, 0), event({ type: 'choose', index: 0 }, 2, 400), event({ type: 'submit' }, 3, 400)];
  const old = replayLegacy(plan, events), current = replay(plan, events);
  assert.deepEqual(current.results, old.results); assert.equal(current.activeMs, 400);
});
test('response does not shorten a timed trial and repeated inputs are retained', () => {
  const plan = make();
  const events = [event({ type: 'present', trialId: plan.trials[0].id, presentation }, 1, 0), event({ type: 'choose', index: 0, input: 'pointer' }, 2, 400), event({ type: 'choose', index: 0, input: 'pointer' }, 3, 600)];
  assert.throws(() => replay(plan, [...events, event({ type: 'submit' }, 4, 601)]), /early/);
  const scored = replay(plan, [...events, event({ type: 'submit' }, 4, 3605)]);
  assert.equal(scored.results[0].responseCount, 2); assert.equal(scored.results[0].hits, 1);
  assert.equal(scored.results[0].durationMs, 3600); assert.equal(scored.results[0].firstResponseMs, 400);
});
test('late timers, missed assets, frame stalls, premature responses and changed input do not become omissions', () => {
  const plan = make();
  const cases = [
    { presentation, input: 'pointer', responseAt: 400, submitAt: 4000, reason: 'timer_late' },
    { presentation: { ...presentation, assetsReady: false }, input: 'pointer', responseAt: 400, submitAt: 3605, reason: 'asset_failure' },
    { presentation: { ...presentation, frameDeltaMs: 130 }, input: 'pointer', responseAt: 400, submitAt: 3605, reason: 'render_failure' },
    { presentation, input: 'pointer', responseAt: 20, submitAt: 3605, reason: 'premature_input' },
    { presentation, input: 'keyboard', responseAt: 400, submitAt: 3605, reason: 'input_changed' },
  ] as const;
  for (const c of cases) {
    const state = replay(plan, [event({ type: 'present', trialId: plan.trials[0].id, presentation: c.presentation }, 1, 0), event({ type: 'choose', index: 0, input: c.input }, 2, c.responseAt), event({ type: 'submit' }, 3, c.submitAt)]);
    assert.equal(state.results.length, 0); assert.equal(state.nextIndex, 0); assert.equal(state.invalidations[0].reason, c.reason);
  }
});
test('an untimed search does not become invalid solely because a frame arrived late', () => {
  const plan = make('search');
  const started = replay(plan, [event({ type: 'present', trialId: plan.trials[0].id, presentation: { ...presentation, frameDeltaMs: 130 } }, 1, 0)]);
  assert.equal(plan.trials[0].windowMs, 0);
  assert.equal(started.active?.invalidReason, null);
});
test('formal timed stimuli must have the specified blank interval', () => {
  const plan = make(), all = completeEvents(plan);
  const index = all.findIndex(e => e.type === 'present' && e.trialId === plan.trials[5].id);
  const prefix = all.slice(0, index);
  assert.throws(() => replay(plan, [...prefix, { ...all[index], at: prefix.at(-1)!.at + TIMING.intervalMs - 1 }]), /interval/);
});
test('search comprehension requires two independent consecutive examples', () => {
  const plan = make('search'), all = completeEvents(plan);
  const second = all.findIndex(e => e.type === 'present' && e.trialId === plan.trials[1].id);
  const prefix = all.slice(0, second + 1), at = prefix.at(-1)!.at;
  const failed = replay(plan, [...prefix, event({ type: 'submit' }, prefix.length + 1, at + 500)]);
  assert.equal(failed.nextIndex, 0);
  const assisted = replay(plan, [...prefix, event({ type: 'help' }, prefix.length + 1, at + 200), event({ type: 'choose', index: plan.trials[1].items.indexOf('rabbit'), input: 'pointer' }, prefix.length + 2, at + 300), event({ type: 'submit' }, prefix.length + 3, at + 500)]);
  assert.equal(assisted.nextIndex, 0);
});
test('memory comprehension examples are distinct across seeds', () => {
  for (let seed = 0; seed < 100; seed++) {
    const plan = createPlan({ ...make('memory'), seed: String(seed), environment: TEST_ENVIRONMENT, content: TEST_CONTENT });
    assert.notDeepEqual(plan.trials[0].sequence, plan.trials[1].sequence);
  }
});
test('device, input and content changes start separate comparable series', () => {
  const base = make('memory');
  const touch = createPlan({ ...base, environment: { ...TEST_ENVIRONMENT, input: 'touch' }, content: TEST_CONTENT });
  const phone = createPlan({ ...base, environment: { ...TEST_ENVIRONMENT, deviceClass: 'phone' }, content: TEST_CONTENT });
  const content = createPlan({ ...base, environment: TEST_ENVIRONMENT, content: { ...TEST_CONTENT, sha256: '1'.repeat(64) } });
  assert.equal(new Set([base.condition, touch.condition, phone.condition, content.condition]).size, 4);
});
test('a recent interrupted or assisted block cannot be skipped to cherry-pick older successes', () => {
  const plan = make('memory'), now = Date.now();
  const evidence = { condition: plan.condition, completedAt: new Date(now).toISOString(), results: replay(plan, completeEvents(plan)).results };
  const interrupted = { ...evidence, invalidations: [{ trialId: plan.trials[2].id, block: 0, practice: false, reason: 'render_failure' }] };
  assert.equal(adapt(plan, [evidence, interrupted, evidence], now).level, 1);
  const helped = { ...evidence, results: replay(plan, completeEvents(plan, { help: true })).results };
  assert.equal(adapt(plan, [helped, evidence, evidence], now).level, 1);
  assert.equal(adapt(plan, [evidence, evidence, evidence], now).level, 2);
});
