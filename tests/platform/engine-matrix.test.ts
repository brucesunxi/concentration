import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, replay, metrics, adapt, TEST_CONTENT, DAILY_LIMIT } from '../../packages/task-engine/index.ts';
import type { AgeBand, Locale, TaskId, Environment } from '../../packages/task-engine/index.ts';
import { completeEvents } from './fixtures.ts';

const ages: AgeBand[] = ['6-8', '9-11', '12-14', '15-17'];
const locales: Locale[] = ['zh-CN', 'en'];
const tasks: TaskId[] = ['search', 'stop', 'memory', 'sustain'];
const environments: Environment[] = [
  { platform: 'web', deviceClass: 'desktop', input: 'pointer', modality: 'visual' },
  { platform: 'web', deviceClass: 'desktop', input: 'keyboard', modality: 'visual' },
  { platform: 'web', deviceClass: 'tablet', input: 'touch', modality: 'visual' },
  { platform: 'ios', deviceClass: 'phone', input: 'touch', modality: 'visual' },
  { platform: 'android', deviceClass: 'phone', input: 'touch', modality: 'visual' },
  { platform: 'android', deviceClass: 'tablet', input: 'touch', modality: 'visual' },
];

test('all development age, language, difficulty and input combinations replay without losing or inflating formal observations', () => {
  let cases = 0;
  const conditions = new Set<string>();
  for (const ageBand of ages) for (const locale of locales) for (const task of tasks)
    for (const level of [1, 2, 3]) for (const environment of environments) for (let seed = 0; seed < 4; seed++) {
      const context = `${ageBand}/${locale}/${task}/${level}/${environment.platform}/${environment.deviceClass}/${environment.input}/${seed}`;
      const input = { id: context, ageBand, locale, task, level, environment, seed: `matrix-${seed}`, content: TEST_CONTENT };
      const plan = createPlan(input);
      assert.deepEqual(plan, createPlan(input), context);
      conditions.add(plan.condition);
      // Protocol counts are an independent expected outcome, not read back from results.
      const formalCount = task === 'sustain' ? [24, 30, 36][level - 1] : task === 'stop' ? 24 : 8;
      const practiceCount = task === 'stop' || task === 'sustain' ? 4 : 2;
      assert.equal(plan.trials.length, formalCount + practiceCount, context);
      assert.equal(new Set(plan.trials.map(trial => trial.id)).size, plan.trials.length, context);
      if (task === 'stop' || task === 'sustain') for (const block of [0, 1]) {
        const deck = plan.trials.filter(trial => !trial.practice && trial.block === block);
        const go = deck.filter(trial => trial.go).length, wait = deck.length - go;
        assert.equal(task === 'stop' ? go : wait, 2 * (task === 'stop' ? wait : go), context);
        assert.ok(deck.every((trial, index) => index < 3 || !deck.slice(index - 3, index).every(prior => prior.go === trial.go)), context);
      }
      const state = replay(plan, completeEvents(plan), DAILY_LIMIT[ageBand]);
      assert.equal(state.ended, true, context);
      assert.equal(state.endReason, 'completed', context);
      assert.equal(state.nextIndex, plan.trials.length, context);
      assert.equal(state.invalidations.length, 0, context);
      assert.ok(state.activeMs > 0 && state.activeMs <= DAILY_LIMIT[ageBand], context);
      const measured = metrics(state.results);
      assert.equal(measured.trials, formalCount, context);
      assert.equal(measured.correct, formalCount, context);
      assert.equal(measured.accuracy, 1, context);
      assert.equal(measured.assisted, 0, context);
      cases++;
    }
  assert.equal(cases, 2304);
  assert.equal(conditions.size, 576, 'age, language, task, level and input conditions must remain distinct');
});

test('inactivity and assisted performance never increase difficulty across the development age and language matrix', () => {
  const now = Date.parse('2026-10-12T08:00:00Z');
  for (const ageBand of ages) for (const locale of locales) for (const task of tasks) for (const level of [1, 2, 3]) {
    const context = `${ageBand}/${locale}/${task}/${level}`;
    const plan = createPlan({ id: context, task, ageBand, locale, level, seed: 'matrix-safety', environment: environments[0], content: TEST_CONTENT });
    for (const assisted of [false, true]) {
      if (!assisted && task !== 'stop' && task !== 'sustain') continue;
      const state = replay(plan, completeEvents(plan, assisted ? { help: true } : { idle: true }));
      const measured = metrics(state.results);
      if (assisted) { assert.equal(measured.trials, 0, context); assert.ok(measured.assisted > 0, context); }
      else assert.equal(measured.balancedAccuracy, 0.5, context);
      const evidence = [1, 2, 3].map(day => ({ condition: plan.condition, completedAt: new Date(now - day * 86400000).toISOString(), results: state.results }));
      assert.ok(adapt(plan, evidence, now).level <= level, context);
    }
  }
});
