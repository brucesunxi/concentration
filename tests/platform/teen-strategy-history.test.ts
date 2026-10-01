import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { TeenStrategyHistoryClient } from '../../packages/session-runtime/teen-strategy-history-client.ts';
import type { TeenStrategyHistory } from '../../packages/contracts/teen-strategy-history.ts';

let db: Database, api: FocusService;
before(async () => { db = await openDatabase('memory://'); await migrate(db); api = service(db); });
after(async () => db.close());
async function family(ageBand: '6-8' | '15-17' = '15-17') {
  const auth = await api.setup({ name: `Trail-${randomUUID()}`.slice(0, 40), password: 'Synthetic-strategy-2026!', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
  const parent = (await api.authenticate(auth.value))!;
  const child = await api.addChild(parent, { alias: 'Fictional child', ageBand, locale: 'en', localConfirmation: true });
  return { parent, child, name: (await api.me(parent)).family.name };
}
async function seed(childId: string, count: number) {
  await db.query(`INSERT INTO sessions(id,child_id,request_key,request_hash,device_id,plan,state,budget_day,budget_ms,result,created_at,closed_reason)
    SELECT gen_random_uuid(),$1,gen_random_uuid()::text,'synthetic',gen_random_uuid(),jsonb_build_object('task',CASE WHEN i%2=0 THEN 'search' ELSE 'memory' END),
    'completed','2026-09-01',0,jsonb_build_object('completed',i%2=0,'metrics',jsonb_build_object('correct',99),'trials',jsonb_build_array('private')),
    '2026-09-01T10:00:00.000000Z'::timestamptz + (i/3)*interval '1 microsecond',CASE WHEN i=1 THEN 'device_handover' ELSE NULL END
    FROM generate_series(1,$2::int) i`, [childId, count]);
}

test('teen sees bounded, score-free own records with stable microsecond pagination', async () => {
  const { parent, child } = await family(); await seed(child.id, 52);
  await assert.rejects(api.teenStrategyHistory(parent, child.id), { code: 'CHILD_REQUIRED' });
  const childAccess = (await api.authenticate((await api.enterChild(parent, child.id)).auth.value))!;
  const expected = (await db.query<{ id: string }>('SELECT id FROM sessions WHERE child_id=$1 ORDER BY created_at DESC,id DESC', [child.id])).rows.map(row => row.id);
  let cursor: string | null = null; const ids: string[] = []; const sizes: number[] = []; const statuses = new Set<string>();
  do {
    const page = await api.teenStrategyHistory(childAccess, child.id, cursor ? { cursor } : {});
    assert.equal(page.childId, child.id); assert.equal(page.pageSize, 20);
    for (const item of page.items) {
      assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'id', 'status', 'task']);
      assert.doesNotMatch(JSON.stringify(item), /correct|metrics|trials|score|private/);
      statuses.add(item.status);
    }
    ids.push(...page.items.map(item => item.id)); sizes.push(page.items.length); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(sizes, [20, 20, 12]); assert.deepEqual(ids, expected);
  assert.deepEqual([...statuses].sort(), ['completed', 'previous-device', 'stopped']);
  assert.equal(new Set(ids).size, 52);
});

test('child, age, cursor, and revoked-session boundaries are enforced', async () => {
  const first = await family(); await seed(first.child.id, 21);
  const younger = await family('6-8');
  const childAccess = (await api.authenticate((await api.enterChild(first.parent, first.child.id)).auth.value))!;
  const cursor = (await api.teenStrategyHistory(childAccess, first.child.id)).nextCursor!;
  await assert.rejects(api.teenStrategyHistory(childAccess, younger.child.id), { code: 'NOT_FOUND' });
  for (const input of [{ cursor: '%%%' }, { cursor: 'a'.repeat(513) }, { cursor: [cursor, cursor] }, { limit: 999 }])
    await assert.rejects(api.teenStrategyHistory(childAccess, first.child.id, input));
  const youngerChild = (await api.authenticate((await api.enterChild(younger.parent, younger.child.id)).auth.value))!;
  await assert.rejects(api.teenStrategyHistory(youngerChild, younger.child.id), { code: 'AGE_GROUP_UNAVAILABLE' });
  const second = await family();
  const secondChild = (await api.authenticate((await api.enterChild(second.parent, second.child.id)).auth.value))!;
  await assert.rejects(api.teenStrategyHistory(secondChild, second.child.id, { cursor }), { code: 'INVALID_HISTORY_CURSOR' });
  const relogin = await api.login({ name: first.name, password: 'Synthetic-strategy-2026!' });
  const owner = (await api.authenticate(relogin.value))!;
  await api.withdraw(owner, first.child.id);
  await assert.rejects(api.teenStrategyHistory(childAccess, first.child.id), { code: 'UNAUTHENTICATED' });
});

test('client preserves a good page after a transient error and clears revoked data', async () => {
  const id = randomUUID();
  const page: TeenStrategyHistory = { version: 'teen-strategy-history-1', childId: id, pageSize: 20,
    items: [{ id: randomUUID(), task: 'search', createdAt: '2026-09-01T10:00:00.000000Z', status: 'completed' }], nextCursor: 'older' };
  let fail: string | null = null;
  const paths: string[] = [];
  const client = new TeenStrategyHistoryClient(id, async <T>(path: string) => {
    paths.push(path);
    if (fail) throw { code: fail }; return { ...page, nextCursor: path.includes('cursor=') ? null : 'older' } as T;
  }, () => {});
  assert.equal(await client.refresh(), true); assert.equal(await client.older(), true); assert.equal(client.state.page, 2);
  fail = 'LOAD_FAILED'; assert.equal(await client.newer(), false); assert.equal(client.state.page, 2); assert.ok(client.state.data);
  fail = 'UNAUTHENTICATED'; assert.equal(await client.newer(), false); assert.equal(client.state.data, null); assert.equal(client.state.denied, true);
  assert.deepEqual(paths, [`/children/${id}/strategy-history`, `/children/${id}/strategy-history?cursor=older`, `/children/${id}/strategy-history`, `/children/${id}/strategy-history`]);
  client.dispose();
});

test('client discards a wrong-profile or expanded response and ignores late replies after leaving', async () => {
  const childId = randomUUID();
  const item = { id: randomUUID(), task: 'search' as const, createdAt: '2026-09-01T10:00:00.000000Z', status: 'completed' as const };
  const valid: TeenStrategyHistory = { version: 'teen-strategy-history-1', childId, pageSize: 20, items: [item], nextCursor: null };
  let response: unknown = valid;
  const client = new TeenStrategyHistoryClient(childId, async <T>() => response as T, () => {});
  await client.refresh(); assert.ok(client.state.data);
  response = { ...valid, childId: randomUUID() };
  await client.refresh(); assert.equal(client.state.data, null); assert.equal(client.state.error, 'STRATEGY_HISTORY_UNSUPPORTED');
  response = { ...valid, items: [{ ...item, metrics: { correct: 99 } }] };
  await client.refresh(); assert.equal(client.state.data, null);
  let complete!: (value: TeenStrategyHistory) => void, updates = 0;
  const late = new TeenStrategyHistoryClient(childId, <T>() => new Promise<T>(resolve => { complete = value => resolve(value as T); }), () => updates++);
  const waiting = late.refresh(), before = updates;
  late.dispose(); complete(valid); await waiting;
  assert.equal(updates, before); assert.equal(late.state.data, null);
});
