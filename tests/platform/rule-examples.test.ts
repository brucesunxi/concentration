import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, TEST_CONTENT, TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { itemLabel } from '../../packages/content/copy.ts';
import { ruleExamples } from '../../packages/content/rule-examples.ts';

test('visual rule examples match every target and distractor the engine can present', () => {
  for (const task of ['search', 'stop', 'sustain'] as const)
    for (const ageBand of ['6-8', '9-11', '12-14', '15-17'] as const)
      for (const locale of ['zh-CN', 'en'] as const) {
        const example = ruleExamples(task, locale)!;
        assert.ok(example.targetAction && example.otherAction);
        assert.ok(itemLabel(example.target, locale, ageBand === '12-14' || ageBand === '15-17'));
        const seen = new Set<string>();
        for (let seed = 0; seed < 10; seed++) {
          const plan = createPlan({ id: 'rule-example', task, ageBand, locale, level: 3, seed: `rule-example-${seed}`,
            environment: TEST_ENVIRONMENT, content: TEST_CONTENT });
          for (const trial of plan.trials) {
            assert.equal(trial.target, example.target);
            for (const item of trial.items) {
              assert.ok(item === example.target || example.others.includes(item));
              if (item !== example.target) seen.add(item);
            }
          }
        }
        assert.deepEqual([...seen].sort(), [...example.others].sort());
      }
  assert.equal(ruleExamples('memory', 'en'), null);
});
