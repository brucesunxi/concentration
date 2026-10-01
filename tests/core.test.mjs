import test from 'node:test';
import assert from 'node:assert/strict';
import { searchBoard, stopDeck, memorySequence, evaluateSearch, evaluateStop, evaluateMemory, nextLevel, localDay, readData, freshData, getDailyPlan, progressSnapshot, getCurriculumWeek } from '../src/core.js';
test('search changes distractor load while retaining two targets at all levels', () => {
  for (const level of [1, 2, 3]) for (let i = 0; i < 50; i++) {
    const board = searchBoard(level); assert.equal(board.length, [6, 9, 12][level - 1]); assert.equal(board.filter(x => x === 'rabbit').length, 2);
  }
});
test('search distinguishes omissions and commissions without rewarding duplicate clicks', () => {
  assert.deepEqual(evaluateSearch(['rabbit', 'fox', 'rabbit'], [0, 0, 1]), { correct: false, hits: 1, omissions: 1, commissions: 1 });
  assert.equal(evaluateSearch(['rabbit', 'fox', 'rabbit'], [0, 2]).correct, true);
});
test('go/no-go covers all four response types', () => {
  assert.equal(evaluateStop('rabbit', true).hits, 1);
  assert.equal(evaluateStop('rabbit', false).omissions, 1);
  assert.equal(evaluateStop('fox', true).commissions, 1);
  assert.equal(evaluateStop('fox', false).correctWait, 1);
});
test('each formal stop block has 8 go and 4 no-go opportunities', () => {
  for (let i = 0; i < 100; i++) { const deck = stopDeck(); assert.equal(deck.length, 12); assert.equal(deck[0], 'rabbit'); assert.equal(deck.filter(x => x === 'fox').length, 4); }
});
test('memory checks both order and completeness', () => {
  assert.equal(evaluateMemory(['apple', 'leaf'], ['leaf', 'apple']).correct, false);
  assert.equal(evaluateMemory(['apple', 'leaf'], ['apple']).correct, false);
  assert.equal(evaluateMemory(['apple', 'leaf'], ['apple', 'leaf']).correct, true);
  for (const level of [1, 2, 3]) { const s = memorySequence(level); assert.equal(s.length, level === 3 ? 3 : 2); assert.equal(new Set(s).size, s.length); }
});
const block = (correct = true, extra = {}) => ({ game: 'search', level: 1, completed: true, trials: Array.from({ length: 3 }, () => ({ correct, assisted: false })), ...extra });
test('difficulty requires two qualifying completed blocks', () => {
  assert.equal(nextLevel(1, [block()], 'search'), 1);
  assert.equal(nextLevel(1, [block(), block()], 'search'), 2);
  assert.equal(nextLevel(2, [block(false, { level: 2 })], 'search'), 1);
});
test('assisted or interrupted blocks prevent progression and cannot be skipped', () => {
  const assisted = block(true, { trials: [{ correct: true, assisted: true }] });
  assert.equal(nextLevel(1, [block(), assisted], 'search'), 1);
  assert.equal(nextLevel(1, [block(), assisted, block()], 'search'), 1);
  assert.equal(nextLevel(1, [block(), block(true, { completed: false })], 'search'), 1);
});
test('difficulty bounds and unrelated games are respected', () => {
  assert.equal(nextLevel(1, [block(false)], 'search'), 1);
  assert.equal(nextLevel(3, [block(true, { level: 3 }), block(true, { level: 3 })], 'search'), 3);
  assert.equal(nextLevel(1, [block(), block(true, { game: 'stop' })], 'search'), 1);
});
test('unavailable storage and malformed data recover safely', () => {
  assert.deepEqual(readData({ getItem() { throw new Error('disabled'); } }), freshData());
  assert.deepEqual(readData({ getItem() { return '{bad'; } }), freshData());
  const d = { ...freshData(), levels: { search: 999 }, sessions: [{ date: '2026-09-15', blocks: [{ game: 'invalid', trials: [] }] }] };
  const restored = readData({ getItem() { return JSON.stringify(d); } });
  assert.equal(restored.levels.search, 1); assert.equal(restored.sessions.length, 0);
});
test('local calendar day does not use UTC conversion', () => {
  assert.equal(localDay(new Date(2026, 8, 15, 0, 5)), '2026-09-15');
});
test('curriculum produces a stable daily route and a real-world transfer cue', () => {
  const data = freshData();
  const plan = getDailyPlan(data, new Date(2026, 8, 15));
  assert.ok(plan.games.length >= 1 && plan.games.length <= 3);
  assert.ok(plan.title && plan.transfer && plan.curriculumId);
  assert.equal(plan.week, getCurriculumWeek(new Date(2026, 8, 15)));
});
test('daily plan rotates away from completed same-day games', () => {
  const data = freshData();
  const first = getDailyPlan(data, new Date(2026, 8, 15));
  data.sessions.push({ date: '2026-09-15', blocks: [{ game: first.games[0], trials: [] }] });
  const next = getDailyPlan(data, new Date(2026, 8, 15));
  assert.ok(next.games.length >= 1);
  assert.notEqual(next.games[0], first.games[0]);
});
test('progress snapshot is per-skill and does not create a global child score', () => {
  const data = freshData();
  data.sessions.push({ date: '2026-09-15', blocks: [{ game: 'search', trials: [{ correct: true }, { correct: false }], completed: true, level: 1 }] });
  const snapshot = progressSnapshot(data, new Date(2026, 8, 15));
  assert.equal(snapshot.search.accuracy, 50);
  assert.equal(snapshot.stop.accuracy, null);
  assert.equal(Object.hasOwn(snapshot, 'total'), false);
});
test('version one records migrate to version two without losing sessions', () => {
  const old = { version: 1, sessions: [{ date: '2026-09-15', blocks: [{ game: 'search', trials: [], completed: true }] }], observations: [], levels: { search: 2, stop: 1, memory: 1 }, sound: false };
  const migrated = readData({ getItem() { return JSON.stringify(old); } });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(migrated.levels.search, 2);
  assert.equal(migrated.voice.provider, 'auto');
});
