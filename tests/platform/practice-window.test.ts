import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { service } from '../../apps/api/service.ts';
import { canonical, signObject, hashObject } from '../../packages/content/index.ts';
import { nativeVerifier } from '../../packages/content/native-verifier.ts';
import { ContinuationClock, grantSchema, verifyGrant, authoritySchema } from '../../packages/session-runtime/authorization.ts';
import { makeOfflineCapsule, verifyOfflineSession } from '../../packages/session-runtime/offline-session.ts';
import { PracticeCheckIn, practiceWindowPolicy, practiceWindowCopy } from '../../packages/session-runtime/practice-window.ts';
import type { PracticePhase } from '../../packages/session-runtime/practice-window.ts';
import type { Result } from '../../packages/contracts/models.ts';
import { SessionRuntime } from '../../packages/session-runtime/index.ts';
import { nextFamilyDay } from '../../packages/session-runtime/day-boundary.ts';
import { completeEvents } from './fixtures.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import type { AgeBand, EngineEvent } from '../../packages/task-engine/index.ts';

let catalogue: Awaited<ReturnType<typeof createLocalContent>>;
let db: Database, api: ReturnType<typeof service>, authority: Awaited<ReturnType<typeof createSessionAuthority>>;
let clock = Date.parse('2026-10-01T08:00:00Z');
before(async () => { db = await openDatabase('memory://'); await migrate(db); authority = await createSessionAuthority(db); catalogue = await createLocalContent(db, { now: () => clock }); api = service(db, () => clock, catalogue, authority); });
after(() => db.close());
async function fixture(age: AgeBand = '6-8', transport: 'web' | 'native' = 'web', timezone = 'UTC') {
  const credentials = { name: 'Window-' + randomUUID().slice(0, 8), password: 'Synthetic-window-password!' };
  const login = await api.setup({ ...credentials, timezone, locale: 'en', acknowledgedLocalUse: true }, transport);
  const p = (await api.authenticate(login.value, transport))!;
  const child = await api.addChild(p, { alias: 'Window QA', ageBand: age, locale: 'en', localConfirmation: true });
  const input = { task: 'search', deviceId: randomUUID(), environment: transport === 'web' ? TEST_ENVIRONMENT : { ...TEST_ENVIRONMENT, platform: 'ios', deviceClass: 'phone', input: 'touch' } };
  const key = randomUUID(), started = await api.start(p, child.id, input, key);
  return { credentials, p, child, input, key, transport, ...started, cp: (await api.authenticate(started.auth.value, transport))! };
}
const parent = async (f: Awaited<ReturnType<typeof fixture>>) => (await api.authenticate((await api.login(f.credentials, f.transport)).value, f.transport))!;
const expected = (f: Awaited<ReturnType<typeof fixture>>) => ({ sessionId: f.session.id, childId: f.child.id, deviceId: f.input.deviceId, plan: f.session.plan, budgetMs: f.session.budget_ms, transport: f.transport });

test('all age windows are signed, bounded separately from active time and verified by both clients', async () => {
  const ages: AgeBand[] = ['6-8', '9-11', '12-14', '15-17'];
  for (const [index, age] of ages.entries()) {
    const f = await fixture(age, index % 2 ? 'native' : 'web'), grant = f.session.continuation_grant!;
    assert.equal(grant.body.version, 2); if (grant.body.version !== 2) throw new Error('missing policy');
    assert.deepEqual(grant.body.windowPolicy, { version: 'practice-window-1', maxElapsedMs: [20, 25, 30, 30][index] * 60000, checkInAfterMs: [4, 5, 6, 6][index] * 60000 });
    assert.equal(Date.parse(grant.body.recordUntil) - clock, grant.body.windowPolicy.maxElapsedMs);
    assert.ok(grant.body.maxActiveMs < grant.body.windowPolicy.maxElapsedMs);
    for (const verifier of [undefined, nativeVerifier]) assert.deepEqual(await verifyGrant(grant, await authority.trust(), expected(f), verifier), grant);
    const exported = await api.exportChild(await parent(f), f.child.id);
    const snapshot = exported.sessions[0].authorization as { version: number; windowPolicy: unknown };
    assert.equal(snapshot.version, 2); assert.deepEqual(snapshot.windowPolicy, grant.body.windowPolicy);
  }
});

test('family midnight, content expiry and restarts never extend a prepared window', async () => {
  const f = await fixture('6-8', 'web', 'America/New_York');
  const boundary = Date.parse('2026-11-02T04:59:45Z'); // after the 25-hour DST day
  const issued = await authority.issue({ id: f.session.id, childId: f.child.id, deviceId: f.input.deviceId, plan: f.session.plan, budgetMs: f.session.budget_ms, transport: 'web', now: boundary, dayEnd: nextFamilyDay(boundary, 'America/New_York'), contentExpiry: boundary + 100000 });
  assert.equal(Date.parse(issued.body.recordUntil), boundary + 15000);
  const shorter = await authority.issue({ id: f.session.id, childId: f.child.id, deviceId: f.input.deviceId, plan: f.session.plan, budgetMs: f.session.budget_ms, transport: 'web', now: boundary, dayEnd: nextFamilyDay(boundary, 'America/New_York'), contentExpiry: boundary + 4000 });
  assert.equal(Date.parse(shorter.body.recordUntil), boundary + 4000);
  clock += 6 * 60000;
  const resumed = await api.start(await parent(f), f.child.id, f.input, randomUUID());
  assert.deepEqual(resumed.session.continuation_grant, f.session.continuation_grant);
  const refreshed = await api.start(await parent(f), f.child.id, f.input, f.key);
  assert.deepEqual(refreshed.session.continuation_grant, f.session.continuation_grant);
});

test('policy tampering, wrong age policy, oversized windows and unknown versions fail closed', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!; assert.equal(grant.body.version, 2);
  if (grant.body.version !== 2) throw new Error('missing policy');
  await assert.rejects(verifyGrant({ ...grant, body: { ...grant.body, windowPolicy: { ...grant.body.windowPolicy, checkInAfterMs: 1 } } }, await authority.trust(), expected(f)), { code: 'INVALID_SESSION_SIGNATURE' });
  assert.equal(grantSchema.safeParse({ ...grant, body: { ...grant.body, recordUntil: new Date(clock + 21 * 60000).toISOString() } }).success, false);
  assert.equal(grantSchema.safeParse({ ...grant, body: { ...grant.body, version: 3 } }).success, false);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const trust = [authoritySchema.parse({ id: 'synthetic', purpose: 'session-continuation', jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) })];
  const body = { ...grant.body, windowPolicy: practiceWindowPolicy('15-17') };
  const signed = { body, signature: await signObject(body, 'synthetic', pair.privateKey) };
  await assert.rejects(verifyGrant(signed, trust, expected(f)), { code: 'SESSION_WINDOW_POLICY_MISMATCH' });
});

test('historical version-one grants keep their original window without acquiring a new policy', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!;
  const { windowPolicy: _policy, ...original } = grant.body as Extract<typeof grant.body, { version: 2 }>;
  const body = { ...original, version: 1 as const, recordUntil: new Date(clock + 3 * 3600000).toISOString() };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const old = { body, signature: await signObject(body, 'historical-test', pair.privateKey) };
  const trust = [authoritySchema.parse({ id: 'historical-test', purpose: 'session-continuation', jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) })];
  assert.deepEqual(await verifyGrant(old, trust, expected(f)), old);
  assert.deepEqual(await verifyGrant(old, trust, expected(f), nativeVerifier), old);
  assert.equal(new ContinuationClock(old, () => clock + 31 * 60000, () => 0).remaining(), 149 * 60000);
  const session = JSON.parse(JSON.stringify({ ...f.session, continuation_grant: old }));
  const capsule = makeOfflineCapsule(f.p.family_id, f.input.deviceId, session, { authorities: trust, status: { id: f.session.id, state: 'active', canContinue: true, grantHash: await hashObject(old), serverTime: new Date(clock).toISOString() } }, { release: await catalogue.release(f.session.plan.content!), keys: await catalogue.trust() });
  const restored = await verifyOfflineSession({ capsule, checkpoint: { highest: clock, fault: null }, journalHash: await hashObject([]) }, f.input.deviceId, 'web', [], undefined, () => clock + 31 * 60000, () => 0);
  assert.equal(restored.capsule.session.continuation_grant.body.version, 1);
  assert.equal(restored.clock.remaining(), 149 * 60000);

});

test('check-ins wait for a safe boundary and explicit continuation restores the same instruction or feedback', () => {
  const policy = practiceWindowPolicy('6-8');
  for (const phase of ['loading', 'active', 'settling', 'summary', 'check-in'] as PracticePhase[]) assert.equal(new PracticeCheckIn(policy).request(600000, phase, false), false);
  for (const phase of ['intro', 'feedback', 'pause', 'rest', 'gap', 'arming'] as PracticePhase[]) {
    const prompt = new PracticeCheckIn(policy);
    assert.equal(prompt.request(239999, phase, false), false);
    assert.equal(prompt.request(240000, phase, true), false, 'An accepted input/presentation is drained first');
    assert.equal(prompt.request(240000, phase, false), true);
    assert.equal(prompt.request(600000, phase, false), false); assert.equal(prompt.pending, true);
    assert.equal(prompt.continue(250000), phase); assert.equal(prompt.pending, false);
    assert.equal(prompt.continue(250000), null, 'A double click does not create another decision');
    assert.equal(prompt.request(489999, phase, false), false); assert.equal(prompt.request(490000, phase, false), true);
  }
});

test('background time and reopening use original elapsed time and cannot renew the recording deadline', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!; if (grant.body.version !== 2) throw new Error('missing policy');
  let wall = Date.parse(grant.body.issuedAt), mono = 0;
  const timer = new ContinuationClock(grant, () => wall, () => mono);
  wall += 241000; // wall clock advances while suspended, monotonic source need not do so
  assert.equal(timer.elapsed(), 241000); const point = timer.checkpoint();
  const reopened = new ContinuationClock(grant, () => wall, () => 0, point);
  assert.equal(new PracticeCheckIn(grant.body.windowPolicy).request(reopened.elapsed(), 'pause', false), true);
  assert.equal(reopened.remaining(), 1200000 - 241000);
  const rollback = new ContinuationClock(grant, () => wall - 5000, () => 0, point);
  assert.throws(() => rollback.elapsed(), { code: 'SESSION_CLOCK_CHANGED' });
  mono = 1200001; wall = Date.parse(grant.body.issuedAt) + mono; assert.equal(timer.remaining(), 0);
  assert.throws(() => timer.assert([{ type: 'choose', index: 0 }]), { code: 'SESSION_AUTHORIZATION_EXPIRED' });
});

test('expiry during a slow accepted save drains it then closes without turning an incomplete step into a score', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!;
  let wall = Date.parse(grant.body.issuedAt), mono = 0, stored: EngineEvent[] = [], release!: () => void;
  const timer = new ContinuationClock(grant, () => wall, () => mono), gate = new Promise<void>(resolve => { release = resolve; });
  const runtime = new SessionRuntime(f.session, { now: () => mono, uuid: randomUUID, authorize: actions => timer.assert(actions), journal: { load: async () => [], save: async events => { if (events.length) await gate; stored = events; }, remove: async () => {} }, send: async () => ({ highestContiguousSeq: 0 }), finalize: async () => { throw new Error('not used'); } });
  await runtime.initialize();
  const saving = runtime.record([{ type: 'present', trialId: f.session.plan.trials[0].id, presentation: { assetsReady: true, frameDeltaMs: 16, method: 'raf-pair' } }]);
  wall = Date.parse(grant.body.recordUntil); mono = 1200000; assert.equal(timer.remaining(), 0);
  release(); await saving; await runtime.settle();
  await runtime.record([{ type: 'interrupt', reason: 'pause' }, { type: 'end', reason: 'time_limit' }]);
  assert.equal(runtime.state.results.length, 0); assert.equal(runtime.state.endReason, 'time_limit'); assert.equal(stored.length, 3);
  await api.append(f.cp, f.session.id, { events: stored });
  const result = await api.finalize(f.cp, f.session.id, { lastSeq: stored.length }) as Result;
  assert.equal(result.completed, false); assert.equal(result.metrics.trials, 0);
});

test('idle instructions can close with zero task time and do not fabricate responses or completed courses', async () => {
  const f = await fixture(), grant = f.session.continuation_grant!;
  clock = Date.parse(grant.body.recordUntil) + 1;
  assert.equal((await api.sessionStatus(f.cp, f.session.id)).canContinue, false);
  const event: EngineEvent = { id: randomUUID(), seq: 1, at: 1200000, type: 'end', reason: 'time_limit' };
  await api.append(f.cp, f.session.id, { events: [event] });
  const result = await api.finalize(f.cp, f.session.id, { lastSeq: 1 }) as Result;
  assert.equal(result.activeMs, 0); assert.equal(result.completed, false);
  assert.equal((await api.report(await parent(f), f.child.id)).child.completedSessions, 0);
  const text = canonical(await api.exportChild(await parent(f), f.child.id));
  assert.ok(text.includes('practice-window-1')); assert.ok(!text.includes('checkInAnswer'));
  for (const locale of ['en', 'zh-CN'] as const) { const copy = practiceWindowCopy(locale, grant.body.recordUntil); assert.ok(copy.intro.length > 20); assert.notEqual(copy.stop, copy.proceed); }
});


test('new window rules start conservatively and cannot borrow historical learning or comparison evidence', async () => {
  const f = await fixture();
  await api.append(f.cp, f.session.id, { events: [{ id: randomUUID(), seq: 1, at: 0, type: 'end', reason: 'child_stopped' }] });
  await api.finalize(f.cp, f.session.id, { lastSeq: 1 });
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const identity = authoritySchema.parse({ id: 'historical-learning-' + randomUUID(), purpose: 'session-continuation', jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) });
  await db.query('INSERT INTO session_authorities(id,identity) VALUES($1,$2)', [identity.id, identity]);
  const legacy = service(db, () => clock, catalogue, { ...authority, issue: async input => {
    const issued = await authority.issue(input); if (issued.body.version !== 2) throw new Error('missing policy');
    const { windowPolicy: _windowPolicy, ...fields } = issued.body;
    const body = { ...fields, version: 1 as const };
    return grantSchema.parse({ body, signature: await signObject(body, identity.id, pair.privateKey) });
  } });
  for (let i = 0; i < 3; i++) {
    const old = await legacy.start(await parent(f), f.child.id, { ...f.input, task: 'memory' }, randomUUID());
    const cp = (await api.authenticate(old.auth.value))!, events = completeEvents(old.session.plan);
    await legacy.append(cp, old.session.id, { events });
    const result = await legacy.finalize(cp, old.session.id, { lastSeq: events.length }) as Result;
    if (i === 2) assert.equal(result.decision.level, 2);
    clock += 10000;
  }
  const next = await api.start(await parent(f), f.child.id, { ...f.input, task: 'memory' }, randomUUID());
  assert.equal(next.session.plan.level, 1);
  const cp = (await api.authenticate(next.auth.value))!, events = completeEvents(next.session.plan);
  await api.append(cp, next.session.id, { events });
  const result = await api.finalize(cp, next.session.id, { lastSeq: events.length }) as Result;
  assert.equal(result.decision.level, 1); assert.equal(result.decision.reason, 'HOLD_MORE_SESSIONS');
  const weekly = await api.weekly(await parent(f), f.child.id);
  const groups = weekly.groups.filter(group => group.task === 'memory');
  assert.equal(groups.length, 2); assert.ok(groups.some(g => g.windowPolicy === null)); assert.ok(groups.some(g => g.windowPolicy?.version === 'practice-window-1'));
});
