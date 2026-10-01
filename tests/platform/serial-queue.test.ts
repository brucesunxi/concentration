import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../../packages/session-runtime/serial-queue.ts';

test('another database operation cannot enter while a cleanup transaction awaits native storage', async () => {
  const queue = new SerialQueue(), calls: string[] = [];
  let finish!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const first = queue.run(async () => { calls.push('begin'); entered(); await gate; calls.push('block-and-delete'); calls.push('commit'); });
  await ready;
  const late = queue.run(async () => { calls.push('late-write-checks-block'); });
  await Promise.resolve(); assert.deepEqual(calls, ['begin']);
  finish(); await Promise.all([first, late]);
  assert.deepEqual(calls, ['begin', 'block-and-delete', 'commit', 'late-write-checks-block']);
});
test('a rejected database operation does not permanently block cleanup retries', async () => {
  const queue = new SerialQueue();
  await assert.rejects(queue.run(async () => { throw new Error('locked'); }), /locked/);
  assert.equal(await queue.run(async () => 'retried'), 'retried');
});
