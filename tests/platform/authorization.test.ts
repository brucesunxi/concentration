import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import type { LocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import type { LocalSessionAuthority } from '../../apps/api/session-authority.ts';
import { AuthorizationError, ContinuationClock, MAX_CONTINUATION_MS, MAX_UPLOAD_MS, verifyGrant } from '../../packages/session-runtime/authorization.ts';
import { nativeVerifier } from '../../packages/content/native-verifier.ts';
import { TEST_ENVIRONMENT, DAILY_LIMIT } from '../../packages/task-engine/index.ts';
import type { EngineEvent } from '../../packages/task-engine/index.ts';
import { completeEvents } from './fixtures.ts';
import { SessionRuntime } from '../../packages/session-runtime/index.ts';
import { nextFamilyDay } from '../../packages/session-runtime/day-boundary.ts';
import { prepareAuthorization } from '../../packages/session-runtime/prepare-authorization.ts';
import { hashObject } from '../../packages/content/index.ts';

let db: Database, api: FocusService, authority: LocalSessionAuthority, content: LocalContent;
let clock = Date.parse('2026-09-30T10:00:00Z');
before(async () => {
  db = await openDatabase('memory://'); await migrate(db);
  authority = await createSessionAuthority(db); content = await createLocalContent(db, { now: () => clock });
  api = service(db, () => clock, content, authority);
});
after(async () => { await db.close(); });
const code = (expected: string) => (error: unknown) => (error instanceof ApiError || error instanceof AuthorizationError) && error.code === expected;
async function fixture() {
  const name = 'Auth-test-' + randomUUID().slice(0, 8), password = 'synthetic-authorization-password';
  const auth = await api.setup({ name, password, locale: 'en', timezone: 'UTC', acknowledgedLocalUse: true });
  const p = (await api.authenticate(auth.value))!;
  const child = await api.addChild(p, { alias: 'Synthetic profile', ageBand: '6-8', locale: 'en', localConfirmation: true });
  const input = { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, key = randomUUID();
  const started = await api.start(p, child.id, input, key), cp = (await api.authenticate(started.auth.value))!;
  return { name, password, p, child, input, key, ...started, cp };
}
async function parent(f: Awaited<ReturnType<typeof fixture>>) { return (await api.authenticate((await api.login({ name: f.name, password: f.password })).value))!; }
const expected = (f: Awaited<ReturnType<typeof fixture>>) => ({ sessionId: f.session.id, childId: f.child.id, deviceId: f.input.deviceId, plan: f.session.plan, budgetMs: f.session.budget_ms, transport: 'web' as const });

test('signed continuation grants bind the complete plan, device, transport, budget and limits with Web/native verification parity', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!, trust = await api.sessionAuthorities();
  assert.deepEqual(await verifyGrant(grant, trust, expected(f)), grant);
  assert.deepEqual(await verifyGrant(grant, trust, expected(f), nativeVerifier), grant);
  assert.equal(grant.body.maxEvents, 3000); assert.equal(grant.body.maxActiveMs, DAILY_LIMIT['6-8']);
  assert.ok(Date.parse(grant.body.recordUntil) - Date.parse(grant.body.issuedAt) <= MAX_CONTINUATION_MS);
  assert.equal(Date.parse(grant.body.recordUntil), Math.min(Date.parse(grant.body.issuedAt) + 20 * 60000, nextFamilyDay(Date.parse(grant.body.issuedAt), 'UTC')));
  assert.equal(Date.parse(grant.body.uploadUntil) - Date.parse(grant.body.issuedAt), MAX_UPLOAD_MS);
  assert.equal(f.cp.device_id, f.input.deviceId); assert.equal((await api.sessionStatus(f.cp, f.session.id)).canContinue, true);
  assert.ok(trust.every(key => key.purpose === 'session-continuation' && !('d' in key.jwk)));
  for (const value of [f.name, f.password, f.child.alias, 'accessToken', 'csrf']) assert.equal(JSON.stringify(grant).includes(value), false);
});

test('tampering, wrong devices, altered plans and untrusted signers cannot authorize a session', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!, trust = await authority.trust();
  await assert.rejects(verifyGrant({ ...grant, body: { ...grant.body, maxActiveMs: 1 } }, trust, expected(f)), code('INVALID_SESSION_SIGNATURE'));
  await assert.rejects(verifyGrant(grant, [], expected(f)), code('UNKNOWN_SESSION_AUTHORITY'));
  await assert.rejects(verifyGrant(grant, trust, { ...expected(f), deviceId: randomUUID() }), code('SESSION_DEVICE_MISMATCH'));
  await assert.rejects(verifyGrant(grant, trust, { ...expected(f), transport: 'native' }), code('SESSION_DEVICE_MISMATCH'));
  await assert.rejects(verifyGrant(grant, trust, { ...expected(f), budgetMs: 1 }), code('SESSION_PLAN_MISMATCH'));
  await assert.rejects(verifyGrant(grant, trust, { ...expected(f), plan: { ...f.session.plan, level: 8 } }), code('SESSION_PLAN_MISMATCH'));
});

test('the recording window cannot outlive the content release or be stretched by exact start retries', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!;
  const short = await authority.issue({ id: f.session.id, childId: f.child.id, deviceId: f.input.deviceId, plan: f.session.plan, budgetMs: f.session.budget_ms, transport: 'web', now: clock, contentExpiry: clock + 20000, dayEnd: nextFamilyDay(clock, 'UTC') });
  assert.equal(Date.parse(short.body.recordUntil) - clock, 20000);
  clock += 5000;
  const retried = await api.start(await parent(f), f.child.id, f.input, f.key);
  assert.deepEqual(retried.session.continuation_grant, grant);
  const again = await api.start((await api.authenticate(retried.auth.value))!, f.child.id, f.input, randomUUID());
  assert.deepEqual(again.session.continuation_grant, grant);
});

test('expiry and clock rollback stop new observations while allowing an honest interruption and incomplete close', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!;
  let wall = Date.parse(grant.body.issuedAt), monotonic = 0;
  const timer = new ContinuationClock(grant, () => wall, () => monotonic);
  timer.assert([{ type: 'present', trialId: f.session.plan.trials[0].id }]);
  wall += MAX_CONTINUATION_MS; monotonic += MAX_CONTINUATION_MS;
  assert.equal(timer.remaining(), 0);
  assert.throws(() => timer.assert([{ type: 'choose', index: 0 }]), code('SESSION_AUTHORIZATION_EXPIRED'));
  assert.doesNotThrow(() => timer.assert([{ type: 'end', reason: 'completed' }]), 'The engine, not the clock, verifies whether all steps were actually completed');
  assert.doesNotThrow(() => timer.assert([{ type: 'interrupt', reason: 'pause' }, { type: 'end', reason: 'time_limit' }]));
  wall = Date.parse(grant.body.issuedAt); monotonic = 0;
  const rollback = new ContinuationClock(grant, () => wall, () => monotonic);
  wall += 10000; monotonic += 10000; rollback.remaining(); wall -= 5000;
  assert.throws(() => rollback.remaining(), code('SESSION_CLOCK_CHANGED'));
  wall += 5000; assert.throws(() => rollback.remaining(), code('SESSION_CLOCK_CHANGED'), 'A clock fault cannot heal merely by changing the clock again');
  assert.doesNotThrow(() => rollback.assert([{ type: 'end', reason: 'time_limit' }]));
});

test('family-day expiry handles short and long DST days and non-hour offsets instead of granting an extra fixed day', () => {
  assert.equal(nextFamilyDay(Date.parse('2026-03-08T05:00:00Z'), 'America/New_York'), Date.parse('2026-03-09T04:00:00Z'));
  assert.equal(nextFamilyDay(Date.parse('2026-11-01T04:00:00Z'), 'America/New_York'), Date.parse('2026-11-02T05:00:00Z'));
  assert.equal(nextFamilyDay(Date.parse('2026-09-30T17:59:59Z'), 'Asia/Kathmandu'), Date.parse('2026-09-30T18:15:00Z'));
  assert.equal(nextFamilyDay(Date.parse('2026-09-30T15:59:59.999Z'), 'Asia/Shanghai'), Date.parse('2026-09-30T16:00:00Z'));
});

test('runtime authorization is checked at observation time, and an expired choice does not poison durable closure', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!;
  let wall = Date.parse(grant.body.issuedAt), monotonic = 0, stored: EngineEvent[] = [];
  const timer = new ContinuationClock(grant, () => wall, () => monotonic);
  const runtime = new SessionRuntime(f.session, { now: () => monotonic, uuid: randomUUID, authorize: actions => timer.assert(actions), journal: { load: async () => [], save: async events => { stored = structuredClone(events); }, remove: async () => {} }, send: async () => ({ highestContiguousSeq: stored.length }), finalize: async () => { throw new Error('not used'); } });
  await runtime.initialize(); await runtime.record([{ type: 'present', trialId: f.session.plan.trials[0].id, presentation: { frameDeltaMs: 16, assetsReady: true, method: 'raf-pair' } }]);
  wall += MAX_CONTINUATION_MS; monotonic = 100;
  await assert.rejects(runtime.record([{ type: 'choose', index: 0 }]), code('SESSION_AUTHORIZATION_EXPIRED'));
  assert.equal(stored.length, 1);
  await runtime.record([{ type: 'interrupt', reason: 'pause' }, { type: 'end', reason: 'time_limit' }]);
  assert.equal(runtime.state.ended, true); assert.equal(runtime.state.endReason, 'time_limit');
  assert.equal(runtime.state.results.length, 0); assert.equal(stored.length, 3);
});

test('a fully recorded attempt can still commit its completion metadata after the recording window closes', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!, recorded = completeEvents(f.session.plan).slice(0, -1);
  const timer = new ContinuationClock(grant, () => Date.parse(grant.body.recordUntil), () => 0);
  const runtime = new SessionRuntime(f.session, { now: () => 0, uuid: randomUUID, authorize: actions => timer.assert(actions), journal: { load: async () => recorded, save: async () => {}, remove: async () => {} }, send: async () => ({ highestContiguousSeq: 0 }), finalize: async () => { throw new Error('not used'); } });
  await runtime.initialize(); await runtime.settle(); await runtime.record([{ type: 'end', reason: 'completed' }]);
  assert.equal(runtime.state.endReason, 'completed'); assert.equal(runtime.state.results.length, f.session.plan.trials.length);
  await assert.rejects(runtime.record([{ type: 'present', trialId: f.session.plan.trials[0].id }]), code('SESSION_AUTHORIZATION_EXPIRED'));
});

test('child-space entry on another device cannot read an active attempt or upload into its device-bound session', async () => {
  const f = await fixture(), p = await parent(f), entered = await api.enterChild(p, f.child.id);
  const unbound = (await api.authenticate(entered.auth.value))!;
  assert.equal(await api.active(unbound), null);
  await assert.rejects(api.sessionStatus(unbound, f.session.id), code('SESSION_DEVICE_MISMATCH'));
  await assert.rejects(api.append(unbound, f.session.id, { events: completeEvents(f.session.plan).slice(0, 1) }), code('SESSION_DEVICE_MISMATCH'));
  await assert.rejects(api.append(await parent(f), f.session.id, { events: completeEvents(f.session.plan).slice(0, 1) }), code('SESSION_DEVICE_MISMATCH'));
  await assert.rejects(api.start(unbound, f.child.id, { ...f.input, deviceId: randomUUID() }, randomUUID()), code('SESSION_CONFLICT'));
  assert.equal((await api.active(f.cp))?.id, f.session.id);
});

test('already recorded events may synchronize after the continuation window, without issuing a fresh recording grant', async () => {
  const f = await fixture(), events = completeEvents(f.session.plan), grant = f.session.continuation_grant!;
  await api.append(f.cp, f.session.id, { events: events.slice(0, 1) });
  clock = Date.parse(grant.body.recordUntil) + 1;
  const restored = await api.start(await parent(f), f.child.id, f.input, f.key), cp = (await api.authenticate(restored.auth.value))!;
  assert.deepEqual(restored.session.continuation_grant, grant); assert.equal((await api.sessionStatus(cp, f.session.id)).canContinue, false);
  await api.append(cp, f.session.id, { events });
  const result = await api.finalize(cp, f.session.id, { lastSeq: events.length });
  assert.equal((result as { completed: boolean }).completed, true); assert.equal((await api.report(await parent(f), f.child.id)).child.completedSessions, 1);
});

test('upload expiry precedes deduplication and a new request retires the stranded reservation without inventing results', async () => {
  const f = await fixture(), first = completeEvents(f.session.plan).slice(0, 1), grant = f.session.continuation_grant!;
  await api.append(f.cp, f.session.id, { events: first });
  // Refresh identity before the protocol deadline so this assertion exercises
  // upload expiry rather than the shorter authentication lifetime.
  clock = Date.parse(grant.body.uploadUntil) - 12 * 3600000;
  const renewed = await api.recover(await parent(f), f.child.id, f.session.id, { deviceId: f.input.deviceId });
  f.cp = (await api.authenticate(renewed.auth.value))!;
  clock = Date.parse(grant.body.uploadUntil);
  await assert.rejects(api.append(f.cp, f.session.id, { events: first }), code('SESSION_UPLOAD_EXPIRED'));
  const p = await parent(f);
  await assert.rejects(api.start(p, f.child.id, f.input, f.key), code('SESSION_UPLOAD_EXPIRED'));
  const next = await api.start(p, f.child.id, f.input, randomUUID()); assert.notEqual(next.session.id, f.session.id);
  const row = (await db.query<{ state: string; used_ms: number; result: unknown; closed_reason: string }>('SELECT state,used_ms,result,closed_reason FROM sessions WHERE id=$1', [f.session.id])).rows[0];
  assert.equal(row.state, 'aborted'); assert.equal(row.used_ms, f.session.budget_ms); assert.equal(row.result, null); assert.equal(row.closed_reason, 'upload_expired');
  const exported = await api.exportChild(await parent(f), f.child.id), text = JSON.stringify(exported);
  assert.equal(exported.events.length, 1); assert.equal(exported.child.completedSessions, 0);
  assert.ok(text.includes('recordUntil')); assert.ok(!text.includes(f.input.deviceId));
  assert.ok(!text.includes('request_hash')); assert.ok(!text.includes('session-signing'));
  const currentClock = clock; clock = Date.parse(grant.body.issuedAt) + 1;
  await assert.rejects(api.append(f.cp, f.session.id, { events: first }), code('SESSION_UPLOAD_EXPIRED'));
  clock = currentClock;
});

test('the client preflight requires a matching live status and blocks clock disagreement even with a valid signature', async () => {
  const f = await fixture(), at = Date.now();
  const grant = await authority.issue({ id: f.session.id, childId: f.child.id, deviceId: f.input.deviceId, plan: f.session.plan, budgetMs: f.session.budget_ms, transport: 'web', now: at, contentExpiry: at + MAX_CONTINUATION_MS, dayEnd: nextFamilyDay(at, 'UTC') });
  const trust = { mode: 'local-development', keys: await authority.trust() };
  const status = { id: f.session.id, state: 'active', canContinue: true, grantHash: await hashObject(grant), serverTime: new Date(at).toISOString() };
  const request = <T>(path: string) => Promise.resolve((path === '/session-authorities' ? trust : status) as T);
  const session = { ...f.session, continuation_grant: grant };
  const ready = await prepareAuthorization(session, f.input.deviceId, request); assert.ok(ready && ready.remaining() > 0);
  status.grantHash = '0'.repeat(64);
  await assert.rejects(prepareAuthorization(session, f.input.deviceId, request), code('SESSION_PLAN_MISMATCH'));
  status.grantHash = await hashObject(grant); status.serverTime = new Date(at + 120000).toISOString();
  const wrongClock = await prepareAuthorization(session, f.input.deviceId, request);
  assert.throws(() => wrongClock!.remaining(), code('SESSION_CLOCK_CHANGED'));
});

test('session creation and credential rotation roll back together if child-token persistence fails', async () => {
  const f = await fixture(), p = await parent(f);
  const child = await api.addChild(p, { alias: 'Synthetic sibling', ageBand: '9-11', locale: 'en', localConfirmation: true });
  const key = randomUUID();
  const broken: Database = { ...db, transaction: fn => db.transaction(tx => fn({ query: (sql, params) => sql.startsWith('INSERT INTO auth_sessions') ? Promise.reject(new Error('simulated token write failure')) : tx.query(sql, params) })) };
  await assert.rejects(service(broken, () => clock, content, authority).start(p, child.id, f.input, key), /simulated token write failure/);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM sessions WHERE child_id=$1', [child.id])).rows[0].n, 0);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM auth_sessions WHERE token_hash=$1', [p.token_hash])).rows[0].n, 1);
  assert.ok((await api.start(p, child.id, f.input, key)).session.continuation_grant);
});

test('revoked collection and recalled content take priority over signed continuation and receipt retries', async () => {
  const f = await fixture(), first = completeEvents(f.session.plan).slice(0, 1);
  await api.append(f.cp, f.session.id, { events: first }); await api.withdraw(await parent(f), f.child.id);
  await assert.rejects(api.sessionStatus(f.cp, f.session.id), code('UNAUTHENTICATED'));
  await assert.rejects(api.append(f.cp, f.session.id, { events: first }), code('UNAUTHENTICATED'));
  const other = await fixture(), firstOther = completeEvents(other.session.plan).slice(0, 1);
  await api.append(other.cp, other.session.id, { events: firstOther });
  await content.recall(other.session.plan.content!.sha256, 'synthetic-reviewer', 'Synthetic recall test');
  await assert.rejects(api.sessionStatus(other.cp, other.session.id), (e: unknown) => (e as { code: string }).code === 'CONTENT_RECALLED');
  await assert.rejects(api.append(other.cp, other.session.id, { events: firstOther }), (e: unknown) => (e as { code: string }).code === 'CONTENT_RECALLED');
});
