import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { Principal, FocusService } from '../../apps/api/service.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { completeEvents } from './fixtures.ts';

let db: Database, api: FocusService;
let clock = Date.parse('2026-09-30T12:00:00Z');
before(async () => { db = await openDatabase('memory://'); await migrate(db); api = service(db, () => clock); });
after(async () => { await db.close(); });
async function family() {
  const name = 'Test-' + randomUUID().slice(0, 8), password = 'test-only-parent-password';
  const auth = await api.setup({ name, password, timezone: 'Asia/Shanghai', locale: 'zh-CN', acknowledgedLocalUse: true });
  const p = (await api.authenticate(auth.value))!;
  const c = await api.addChild(p, { alias: 'Test explorer', ageBand: '6-8', locale: 'zh-CN', localConfirmation: true });
  return { p, c, name, password, auth };
}
async function relogin(f: Awaited<ReturnType<typeof family>>) { return (await api.authenticate((await api.login({ name: f.name, password: f.password })).value))!; }
function status(code: string) { return (e: unknown) => e instanceof ApiError && e.code === code; }

test('database migration is repeatable and credentials are never included in family response', async () => {
  await migrate(db); const f = await family(); const me = await api.me(f.p);
  assert.equal(me.children.length, 1); assert.equal(me.role, 'parent');
  assert.ok(!JSON.stringify(me).includes('password')); assert.ok(!JSON.stringify(me).includes('token_hash'));
  await assert.rejects(api.login({ name: f.name, password: 'incorrect' }), status('LOGIN_FAILED'));
});
test('observation retries are atomic and content-bound while withdrawal takes precedence over deduplication', async () => {
  const f = await family(), key = randomUUID();
  const input = { task: 'search', context: 'packing', prompts: 2, childChoice: true };
  const [first, again] = await Promise.all([api.observe(f.p, f.c.id, input, key), api.observe(f.p, f.c.id, { ...input }, key)]);
  assert.equal(first.id, again.id); assert.equal((await api.report(f.p, f.c.id)).observationCount, 1);
  await assert.rejects(api.observe(f.p, f.c.id, { ...input, prompts: 3 }, key), status('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(api.observe(f.p, f.c.id, input, ''), status('INVALID_IDEMPOTENCY_KEY'));
  const exported = JSON.stringify(await api.exportChild(f.p, f.c.id));
  assert.ok(!exported.includes(key)); assert.ok(!exported.includes('request_hash'));
  await api.withdraw(f.p, f.c.id);
  await assert.rejects(api.observe(f.p, f.c.id, input, key), status('CONSENT_REVOKED'));
});
test('family boundaries and child scope are enforced across reports and uploads', async () => {
  const a = await family(), b = await family();
  await assert.rejects(api.report(a.p, b.c.id), status('NOT_FOUND'));
  await assert.rejects(api.start(a.p, b.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId: randomUUID() }, randomUUID()), status('NOT_FOUND'));
  const { session: s, auth } = await api.start(a.p, a.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId: randomUUID() }, randomUUID());
  assert.equal(await api.authenticate(a.auth.value), null, 'Starting practice removes the parent browser session');
  const cp = (await api.authenticate(auth.value))!;
  assert.equal((await api.me(cp)).role, 'child');
  await assert.rejects(api.report(cp, a.c.id), status('PARENT_REQUIRED'));
  await assert.rejects(api.append(b.p, s.id, { events: completeEvents(s.plan).slice(0, 1) }), status('NOT_FOUND'));
});
test('event ingestion is atomic, detects conflicts, tolerates reordered arrival and finalizes once', async () => {
  const f = await family(), key = randomUUID(), device = randomUUID();
  const { session: s, auth } = await api.start(f.p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId: device }, key);
  const cp = (await api.authenticate(auth.value))!, events = completeEvents(s.plan);
  const last = await api.append(cp, s.id, { events: events.slice(3) }); assert.equal(last.highestContiguousSeq, 0);
  await assert.rejects(api.finalize(cp, s.id, { lastSeq: events.length }), status('MISSING_EVENTS'));
  const first = await api.append(cp, s.id, { events: events.slice(0, 3) }); assert.equal(first.highestContiguousSeq, events.length);
  const duplicate = await api.append(cp, s.id, { events: events.slice(0, 3) }); assert.equal(duplicate.duplicateIds.length, 3);
  await assert.rejects(api.append(cp, s.id, { events: [{ ...events[0], at: 99999 }] }), status('EVENT_CONFLICT'));
  const result = await api.finalize(cp, s.id, { lastSeq: events.length });
  assert.deepEqual(await api.finalize(cp, s.id, { lastSeq: events.length }), result);
  const parent = await relogin(f), report = await api.report(parent, f.c.id);
  assert.equal(report.child.completedSessions, 1); assert.equal(report.child.course.unit, 1); assert.equal(report.sessions.length, 1);
  assert.equal((result as { metrics: { accuracy: number } }).metrics.accuracy, 1);
});
test('free-choice practice is recorded without skipping the recommended curriculum', async () => {
  const f = await family();
  const { session: s, auth } = await api.start(f.p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'memory', deviceId: randomUUID() }, randomUUID());
  const cp = (await api.authenticate(auth.value))!, events = completeEvents(s.plan);
  await api.append(cp, s.id, { events }); await api.finalize(cp, s.id, { lastSeq: events.length });
  const report = await api.report(await relogin(f), f.c.id);
  assert.equal(report.child.completedSessions, 1);
  assert.equal(report.child.course.unit, 0); assert.equal(report.child.course.weekDone, 0);
  assert.equal(report.child.course.task, 'search');
});
test('malformed protocol writes roll back and client correctness flags cannot be injected', async () => {
  const f = await family(); const { session: s, auth } = await api.start(f.p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'memory', deviceId: randomUUID() }, randomUUID());
  const cp = (await api.authenticate(auth.value))!;
  await assert.rejects(api.append(cp, s.id, { events: [{ id: randomUUID(), seq: 1, at: 0, type: 'present', trialId: s.plan.trials[1].id }] }), /order/);
  const count = await db.query<{ n: number }>('SELECT count(*)::int n FROM events WHERE session_id=$1', [s.id]); assert.equal(count.rows[0].n, 0);
  await assert.rejects(api.append(cp, s.id, { events: [{ ...completeEvents(s.plan)[0], correct: true }] }));
});
test('idempotency keys bind request content and another device cannot take over silently', async () => {
  const f = await family(), key = randomUUID(), deviceId = randomUUID();
  const { session: s } = await api.start(f.p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId }, key);
  const p = await relogin(f);
  assert.equal((await api.start(p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId }, key)).session.id, s.id);
  await assert.rejects(api.start(await relogin(f), f.c.id, { environment: TEST_ENVIRONMENT, task: 'stop', deviceId }, key), status('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(api.start(await relogin(f), f.c.id, { environment: TEST_ENVIRONMENT, task: 'stop', deviceId: randomUUID() }, randomUUID()), status('SESSION_CONFLICT'));
});
test('withdrawal blocks old uploads before deduplication and revokes child credentials', async () => {
  const f = await family(); const { session: s, auth } = await api.start(f.p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId: randomUUID() }, randomUUID());
  const cp = (await api.authenticate(auth.value))!, first = completeEvents(s.plan).slice(0, 1);
  await api.append(cp, s.id, { events: first });
  await api.withdraw(await relogin(f), f.c.id);
  assert.equal(await api.authenticate(auth.value), null);
  await assert.rejects(api.append(cp, s.id, { events: first }), status('UNAUTHENTICATED'));
  await assert.rejects(api.observe(await relogin(f), f.c.id, { task: 'search', context: 'packing', prompts: 1, childChoice: true }, randomUUID()), status('CONSENT_REVOKED'));
});
test('collection fails closed when local preview evidence is absent, invalid or withdrawn', async () => {
  for (const mutation of [
    (id: string) => db.query('DELETE FROM local_confirmations WHERE child_id=$1', [id]),
    (id: string) => db.query("UPDATE local_confirmations SET purpose='another-purpose' WHERE child_id=$1", [id]),
    (id: string) => db.query("UPDATE local_confirmations SET version='obsolete' WHERE child_id=$1", [id]),
    (id: string) => db.query('UPDATE local_confirmations SET withdrawn_at=$2 WHERE child_id=$1', [id, new Date(clock).toISOString()]),
    (id: string) => db.query('UPDATE local_confirmations SET acknowledged_at=$2 WHERE child_id=$1', [id, new Date(clock + 86400000).toISOString()]),
  ]) {
    const f = await family();
    const { session: s, auth } = await api.start(f.p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId: randomUUID() }, randomUUID());
    const cp = (await api.authenticate(auth.value))!;
    const parentScope = await relogin(f);
    await mutation(f.c.id);
    const me = await api.me(parentScope);
    assert.equal(me.children[0].consentActive, false);
    assert.equal(me.children[0].localPreviewConfirmation, false);
    assert.equal(me.children[0].verifiedGuardianConsent, false);
    assert.equal((await api.practiceLimits(parentScope, f.c.id)).availableMs, 0);
    const life = await api.lifeSpace(parentScope, f.c.id);
    assert.equal(life.collectionActive, false);
    await assert.rejects(api.createLifeGoal(parentScope, f.c.id, { intent: 'suggest', templateId: 'steps', support: 'ask-first', contentHash: life.content.hash }, randomUUID()), status('CONSENT_REVOKED'));
    await assert.rejects(api.start(parentScope, f.c.id, { environment: TEST_ENVIRONMENT, task: 'search', deviceId: randomUUID() }, randomUUID()), status('CONSENT_REVOKED'));
    await assert.rejects(api.append(cp, s.id, { events: completeEvents(s.plan).slice(0, 1) }), status('CONSENT_REVOKED'));
    await assert.rejects(api.observe(parentScope, f.c.id, { task: 'search', context: 'packing', prompts: 0, childChoice: true }, randomUUID()), status('CONSENT_REVOKED'));
    assert.equal((await api.exportChild(parentScope, f.c.id)).child.consentActive, false);
    assert.deepEqual(await api.withdraw(parentScope, f.c.id), { withdrawn: true });
    assert.deepEqual(await api.deleteChild(parentScope, f.c.id), { deleted: true });
  }
});
test('profile deletion cascades through events, sessions, confirmations and prevents resurrection', async () => {
  const f = await family(); const { session: s, auth } = await api.start(f.p, f.c.id, { environment: TEST_ENVIRONMENT, task: 'stop', deviceId: randomUUID() }, randomUUID());
  const cp = (await api.authenticate(auth.value))!, events = completeEvents(s.plan).slice(0, 1);
  await api.append(cp, s.id, { events }); await api.deleteChild(await relogin(f), f.c.id);
  for (const [table, field, value] of [['events', 'session_id', s.id], ['sessions', 'child_id', f.c.id], ['local_confirmations', 'child_id', f.c.id], ['auth_sessions', 'child_id', f.c.id]]) {
    assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int n FROM ${table} WHERE ${field}=$1`, [value])).rows[0].n, 0);
  }
  await assert.rejects(api.append(cp, s.id, { events }), status('UNAUTHENTICATED'));
});
test('sensitive parent operations require recent password verification', async () => {
  const f = await family(); clock += 11 * 60000;
  await assert.rejects(api.exportChild(f.p, f.c.id), status('REAUTH_REQUIRED'));
  await assert.rejects(api.deleteChild(f.p, f.c.id), status('REAUTH_REQUIRED'));
  assert.ok(await api.exportChild(await relogin(f), f.c.id));
});
test('export and weekly review include all observations instead of inheriting the report display limit', async () => {
  const f = await family();
  for (let i = 0; i < 51; i++) await api.observe(f.p, f.c.id, { task: 'search', context: 'tidying', prompts: i % 3, childChoice: true }, randomUUID());
  const report = await api.report(f.p, f.c.id), exported = await api.exportChild(f.p, f.c.id);
  assert.equal(report.observations.length, 50); assert.equal(report.observationCount, 51);
  assert.equal(exported.observations.length, 51); assert.equal(exported.confirmations.length, 1);
  const weekly = await api.weekly(f.p, f.c.id);
  assert.equal(weekly.life[0].current.count, 51); assert.equal(weekly.days.reduce((n, day) => n + day.observations, 0), 51);
  assert.equal(JSON.stringify(exported).includes('password_hash'), false);
  assert.equal(JSON.stringify(exported).includes('token_hash'), false);
});

test('weekly review enforces parent and family boundaries, validates dates and remains readable after withdrawal', async () => {
  const f = await family(), stranger = await family();
  await assert.rejects(api.weekly(stranger.p, f.c.id), status('NOT_FOUND'));
  await assert.rejects(api.weekly(f.p, f.c.id, { weekStart: '2026-02-30' }), status('INVALID_REPORT_WEEK'));
  await assert.rejects(api.weekly(f.p, f.c.id, { unknown: true }));
  const { session: s, auth } = await api.start(f.p, f.c.id, { task: 'search', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID());
  const childScope = (await api.authenticate(auth.value))!;
  await assert.rejects(api.weekly(childScope, f.c.id), status('PARENT_REQUIRED'));
  const events = completeEvents(s.plan);
  await api.append(childScope, s.id, { events }); await api.finalize(childScope, s.id, { lastSeq: events.length });
  const parentScope = await relogin(f);
  const report = await api.weekly(parentScope, f.c.id);
  assert.equal(report.coverage.finalized, 1); assert.equal(report.timezone, 'Asia/Shanghai');
  assert.equal(report.groups[0].current.metrics.correct, 8);
  const serialized = JSON.stringify(report);
  for (const field of ['password_hash', 'request_key', 'device_id', 'token_hash', 'csrf', 'seed']) assert.equal(serialized.includes(field), false);
  await api.withdraw(parentScope, f.c.id); assert.equal((await api.weekly(parentScope, f.c.id)).coverage.completed, 1);
  await api.deleteChild(parentScope, f.c.id); await assert.rejects(api.weekly(parentScope, f.c.id), status('NOT_FOUND'));
});

test('switching input conditions starts conservatively and preserves the prior condition level', async () => {
  const f = await family(); let scope = f.p;
  for (let i = 0; i < 3; i++) {
    const { session: s, auth } = await api.start(scope, f.c.id, { task: 'memory', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID());
    scope = (await api.authenticate(auth.value))!;
    const events = completeEvents(s.plan);
    await api.append(scope, s.id, { events }); await api.finalize(scope, s.id, { lastSeq: events.length });
    clock += 10000;
  }
  const other = await api.start(scope, f.c.id, { task: 'memory', deviceId: randomUUID(), environment: { ...TEST_ENVIRONMENT, input: 'keyboard' } }, randomUUID());
  assert.equal(other.session.plan.level, 1);
  scope = (await api.authenticate(other.auth.value))!;
  const stop = { id: randomUUID(), seq: 1, at: 0, type: 'end', reason: 'child_stopped' };
  await api.append(scope, other.session.id, { events: [stop] }); await api.finalize(scope, other.session.id, { lastSeq: 1 });
  const original = await api.start(scope, f.c.id, { task: 'memory', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID());
  assert.equal(original.session.plan.level, 2);
});
