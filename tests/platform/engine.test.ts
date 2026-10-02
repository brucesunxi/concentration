import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPlan, replay, metrics, adapt, courseUnit, TASKS, wilsonLower, TEST_ENVIRONMENT, TEST_CONTENT } from '../../packages/task-engine/index.ts';
import type { TaskId, EngineEvent, Action } from '../../packages/task-engine/index.ts';
import { completeEvents } from './fixtures.ts';
const planFor = (task: TaskId, seed = 'test-seed', level = 1) => createPlan({ id: 'plan', task, ageBand: '6-8', locale: 'zh-CN', seed, level, environment: TEST_ENVIRONMENT, content: TEST_CONTENT });

test('all four protocols generate reproducible plans and score real observations', () => {
  for (const task of TASKS) {
    const plan = planFor(task);
    assert.deepEqual(plan, planFor(task));
    const state = replay(plan, completeEvents(plan));
    assert.equal(state.nextIndex, plan.trials.length); assert.equal(state.ended, true);
    assert.equal(metrics(state.results).accuracy, 1); assert.ok(state.activeMs > 0);
    assert.equal(metrics(state.results).trials, plan.trials.filter(x => !x.practice).length);
  }
});
test('search target counts vary and inhibitory decks have bounded runs without fixed first stimulus', () => {
  const counts = new Set(), first = new Set();
  for (let seed = 0; seed < 100; seed++) {
    for (const trial of planFor('search', String(seed)).trials.filter(x => !x.practice)) counts.add(trial.items.filter(x => x === 'rabbit').length);
    const trials = planFor('stop', String(seed)).trials.filter(x => !x.practice);
    first.add(trials[0].go);
    for (const block of [0, 1]) {
      const deck = trials.filter(x => x.block === block);
      assert.equal(deck.filter(x => x.go).length, 8); assert.equal(deck.filter(x => !x.go).length, 4);
      assert.ok(deck.every((v, i) => i < 3 || !(v.go === deck[i - 1].go && v.go === deck[i - 2].go && v.go === deck[i - 3].go)));
    }
  }
  assert.deepEqual(counts, new Set([1, 2])); assert.equal(first.size, 2);
});
test('difficulty actually changes the intended dimension', () => {
  const m = [1, 2, 3].map(level => planFor('memory', 'x', level).trials.find(t => !t.practice)!.sequence.length);
  assert.deepEqual(m, [2, 3, 4]);
  assert.deepEqual([1, 2, 3].map(l => planFor('sustain', 'x', l).trials.filter(t => !t.practice).length), [24, 30, 36]);
  assert.ok(planFor('stop', 'x', 3).trials.some(t => !t.practice && ['bear', 'cat'].includes(t.items[0])));
});
test('inactivity cannot pass go/no-go adaptation through correct waits', () => {
  const plan = planFor('stop'); const state = replay(plan, completeEvents(plan, { idle: true }));
  assert.equal(metrics(state.results).balancedAccuracy, .5);
  const now = Date.parse('2026-09-30T12:00:00Z');
  const history = [1, 2, 3].map(x => ({ condition: plan.condition, completedAt: new Date(now - x * 10000).toISOString(), results: state.results }));
  assert.equal(adapt(plan, history, now).level, 1);
});
test('small samples, modality mismatches, and help do not earn an unsupported upgrade', () => {
  const plan = planFor('memory'); const now = Date.parse('2026-09-30T12:00:00Z');
  const evidence = { condition: plan.condition, completedAt: new Date(now).toISOString(), results: replay(plan, completeEvents(plan)).results };
  assert.equal(adapt(plan, [evidence], now).level, 1);
  assert.equal(adapt(plan, [evidence, evidence], now).level, 1);
  assert.equal(adapt(plan, [evidence, evidence, evidence], now).level, 2);
  assert.equal(adapt(plan, [evidence, evidence, { ...evidence, condition: 'other' }], now).level, 1);
  assert.equal(adapt(plan, [evidence, evidence, { ...evidence, results: replay(plan, completeEvents(plan, { help: true })).results }], now).level, 1);
  assert.equal(wilsonLower(0, 0), null); assert.ok(wilsonLower(18, 20)! > .7);
});
test('screen reader input is a separate untimed native condition and cannot drive difficulty', () => {
  const environment = { platform: 'ios' as const, deviceClass: 'phone' as const, input: 'assistive' as const, modality: 'visual' as const };
  const plan = createPlan({ id: 'assistive-plan', task: 'search', ageBand: '6-8', locale: 'en', seed: 'assistive-seed', level: 1, environment, content: TEST_CONTENT });
  assert.ok(plan.trials.every(trial => trial.windowMs === 0));
  assert.notEqual(plan.condition, planFor('search').condition);
  const results = replay(plan, completeEvents(plan)).results;
  assert.equal(metrics(results).trials, 8);
  const now = Date.parse('2026-09-30T12:00:00Z');
  const evidence = { condition: plan.condition, completedAt: new Date(now).toISOString(), results };
  assert.deepEqual(adapt(plan, [evidence, evidence, evidence], now), { level: 1, reason: 'HOLD_ASSISTIVE_MODE_UNVALIDATED' });
  assert.throws(() => createPlan({ ...plan, task: 'stop', environment, content: TEST_CONTENT }), /Timed or web assistive/);
  assert.throws(() => createPlan({ ...plan, task: 'memory', environment: { ...environment, platform: 'web' }, content: TEST_CONTENT }), /Timed or web assistive/);
  const wrongInput = completeEvents(plan);
  const choice = wrongInput.find(event => event.type === 'choose')!;
  (choice as Extract<EngineEvent, { type: 'choose' }>).input = 'touch';
  const firstSubmit = wrongInput.findIndex(event => event.type === 'submit');
  assert.equal(replay(plan, wrongInput.slice(0, firstSubmit + 1)).invalidations[0]?.reason, 'input_changed');
});
test('out of order trials, early waiting, visible-memory answers, and incomplete completion are rejected', () => {
  const event = (action: Action, seq: number, at: number): EngineEvent => ({ ...action, ...(action.type === 'present' ? { presentation: { frameDeltaMs: 16, assetsReady: true, method: 'raf-pair' as const } } : {}), id: randomUUID(), seq, at });
  const search = planFor('search');
  assert.throws(() => replay(search, [event({ type: 'present', trialId: search.trials[1].id }, 1, 0)]), /order/);
  assert.throws(() => replay(search, [event({ type: 'end', reason: 'completed' }, 1, 0)]), /unfinished/);
  const memory = planFor('memory');
  assert.throws(() => replay(memory, [event({ type: 'present', trialId: memory.trials[0].id }, 1, 0), event({ type: 'choose', index: 0 }, 2, 100)]), /visible/);
  const stop = planFor('stop');
  assert.throws(() => replay(stop, [event({ type: 'present', trialId: stop.trials[0].id }, 1, 0), event({ type: 'submit' }, 2, 100)]), /early/);
});
test('an interruption is not an omission and requires the same trial to be re-presented', () => {
  const plan = planFor('stop');
  const events: EngineEvent[] = [{ id: randomUUID(), seq: 1, at: 0, type: 'present', trialId: plan.trials[0].id, presentation: { frameDeltaMs: 16, assetsReady: true, method: 'raf-pair' } }, { id: randomUUID(), seq: 2, at: 500, type: 'interrupt', reason: 'background' }];
  const s = replay(plan, events); assert.equal(s.results.length, 0); assert.equal(s.nextIndex, 0); assert.equal(s.interruptions, 1); assert.equal(s.activeMs, 500);
  assert.throws(() => replay(plan, [...events, { id: randomUUID(), seq: 3, at: 501, type: 'present', trialId: plan.trials[1].id }]), /order/);
  assert.throws(() => replay(plan, [...events, { id: randomUUID(), seq: 3, at: 501, type: 'present', trialId: plan.trials[0].id }], 500), /limit/);
});
test('course is based on completed sessions and never the current calendar week', () => {
  assert.deepEqual(courseUnit(0), { week: 1, unit: 0, task: 'search', complete: false, weekDone: 0 });
  assert.deepEqual(courseUnit(3), { week: 2, unit: 3, task: 'stop', complete: false, weekDone: 0 });
  assert.equal(courseUnit(999).week, 8);
  assert.equal(courseUnit(24).complete, true); assert.equal(courseUnit(24).weekDone, 3);
  assert.equal(courseUnit(23).complete, false); assert.equal(courseUnit(23).weekDone, 2);
  assert.equal(metrics([]).accuracy, null);
});
