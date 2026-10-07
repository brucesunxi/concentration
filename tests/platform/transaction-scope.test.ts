import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionScope } from '../../apps/api/transaction-scope.ts';
import type { Database, Queryable } from '../../apps/api/database.ts';

test('repeatable-read option reaches the outer transaction and cannot be added after it starts', async () => {
  const seen: boolean[] = [];
  const query: Queryable = { async query() { return { rows: [] }; } };
  const source: Database = {
    ...query,
    async transaction(fn, options) { seen.push(!!options?.repeatableRead); return fn(query); },
    async close() {},
  };
  const scoped = transactionScope(source);
  await scoped.transaction(async () => {
    await scoped.transaction(async () => { await scoped.query('SELECT 1'); }, { repeatableRead: true });
  }, { repeatableRead: true });
  assert.deepEqual(seen, [true]);
  await assert.rejects(scoped.transaction(() => scoped.transaction(async () => {}, { repeatableRead: true })), /REPEATABLE_READ_MUST_START_OUTER_TRANSACTION/);
  assert.deepEqual(seen, [true, false]);
});
