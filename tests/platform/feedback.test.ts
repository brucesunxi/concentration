import test from 'node:test';
import assert from 'node:assert/strict';
import type { Trial, TrialResult } from '../../packages/task-engine/index.ts';
import { feedbackGuidance, searchTargetPositions } from '../../packages/content/feedback.ts';

const result = (task: TrialResult['task'], overrides: Partial<TrialResult> = {}): TrialResult => ({
  trialId: 'example', task, block: -1, practice: true, assisted: false,
  correct: false, hits: 0, targets: 1, falseAlarms: 0, distractors: 0,
  matched: 0, length: 0, durationMs: 3000, ...overrides,
});

test('both clients give the same correction for a false response and a missed target', () => {
  const strategy = 'Pause and check.';
  for (const task of ['stop', 'sustain'] as const) {
    assert.match(feedbackGuidance(result(task, { falseAlarms: 1, targets: 0 }), strategy, 'en'), /not the target/i);
    assert.match(feedbackGuidance(result(task), strategy, 'en'), /was the target/i);
    assert.match(feedbackGuidance(result(task, { falseAlarms: 1, targets: 0 }), strategy, 'zh-CN'), /不是目标/);
    assert.equal(feedbackGuidance(result(task, { correct: true }), strategy, 'en'), strategy);
  }
  assert.equal(feedbackGuidance(result('memory'), strategy, 'en'), strategy);
  assert.equal(feedbackGuidance(result('search'), strategy, 'en'), strategy);
});

test('search correction follows the frozen trial target instead of assuming a particular picture', () => {
  const trial: Trial = { id: 'example', task: 'search', practice: true, block: -1, items: ['fox', 'rabbit', 'cat', 'rabbit'], target: 'rabbit', sequence: [], go: true, windowMs: 0 };
  assert.deepEqual(searchTargetPositions(trial), [2, 4]);
  assert.deepEqual(searchTargetPositions({ ...trial, target: 'fox' }), [1]);
  assert.deepEqual(searchTargetPositions({ ...trial, task: 'memory' }), []);
});
