import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import type { LocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { hashObject } from '../../packages/content/index.ts';
import { nativeVerifier } from '../../packages/content/native-verifier.ts';
import { ContinuationClock } from '../../packages/session-runtime/authorization.ts';
import { makeOfflineCapsule, verifyOfflineSession, offlineCapsuleSchema, NetworkUnavailable, isNetworkFailure } from '../../packages/session-runtime/offline-session.ts';
import type { OfflineSaved } from '../../packages/session-runtime/offline-session.ts';
import { SessionRuntime } from '../../packages/session-runtime/index.ts';
import type { Result } from '../../packages/contracts/models.ts';
import { completeEvents } from './fixtures.ts';

const now = Date.parse('2026-09-30T10:00:00Z');
let db: Database, api: FocusService, content: LocalContent;
before(async () => {
  db = await openDatabase('memory://'); await migrate(db);
  content = await createLocalContent(db, { now: () => now });
  api = service(db, () => now, content, await createSessionAuthority(db));
});
after(async () => { await db.close(); });
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

async function fixture(platform: 'ios'|'android' = 'ios') {
  const auth = await api.setup({ name: 'Offline-' + randomUUID().slice(0, 8), password: 'synthetic-offline-password', locale: 'en', timezone: 'UTC', acknowledgedLocalUse: true }, 'native');
  const parent = (await api.authenticate(auth.value, 'native'))!;
  const child = await api.addChild(parent, { alias: 'Synthetic private alias', ageBand: '9-11', locale: 'en', localConfirmation: true });
  const deviceId = randomUUID();
  const response = await api.start(parent, child.id, { task: 'search', deviceId, environment: { platform, deviceClass: 'phone', input: 'touch', modality: 'visual' } }, randomUUID());
  // Match the native HTTP boundary: database timestamps arrive as JSON strings.
  const started = { ...response, session: JSON.parse(JSON.stringify(response.session)) as typeof response.session };
  const principal = (await api.authenticate(started.auth.value, 'native'))!;
  const proof = { authorities: await api.sessionAuthorities(), status: await api.sessionStatus(principal, started.session.id) };
  const media = { release: await content.release(started.session.plan.content!), keys: await content.trust() };
  const capsule = makeOfflineCapsule(parent.family_id, deviceId, started.session, proof, media);
  const events = completeEvents(started.session.plan).slice(0, 1);
  const saved: OfflineSaved = { capsule, checkpoint: { highest: now, fault: null }, journalHash: await hashObject(events) };
  return { deviceId, started, principal, parent, proof, media, events, saved };
}
const verify = (f: Awaited<ReturnType<typeof fixture>>, saved = f.saved, events: unknown[] = f.events, time = now) => verifyOfflineSession(saved, f.deviceId, 'ios', events, nativeVerifier, () => time, () => 0);

test('native offline verification restores only the signed prepared plan with a separately hashed journal', async () => {
  for (const platform of ['ios', 'android'] as const) {
    const f = await fixture(platform);
    const result = await verifyOfflineSession(f.saved, f.deviceId, platform, f.events, nativeVerifier, () => now, () => 0);
    assert.deepEqual(result.capsule.session.plan, f.started.session.plan);
    assert.equal(result.pack.locale, 'en'); assert.ok(result.clock.remaining() > 0);
    const serialized = JSON.stringify(result.capsule);
    for (const secret of [f.started.auth.value, f.started.auth.csrf, 'Synthetic private alias', 'synthetic-offline-password', 'accessToken', 'events']) assert.equal(serialized.includes(secret), false);
    assert.throws(() => offlineCapsuleSchema.parse({ ...f.saved.capsule, accessToken: f.started.auth.value }));
  }
});

test('offline restore rejects changed device, platform, signature, plan and content', async () => {
  const f = await fixture();
  await assert.rejects(verifyOfflineSession(f.saved, randomUUID(), 'ios', f.events, nativeVerifier, () => now), code('OFFLINE_DEVICE_MISMATCH'));
  await assert.rejects(verifyOfflineSession(f.saved, f.deviceId, 'android', f.events, nativeVerifier, () => now), code('OFFLINE_DEVICE_MISMATCH'));
  const signature = structuredClone(f.saved); signature.capsule.session.continuation_grant.signature.value = '0'.repeat(128);
  await assert.rejects(verify(f, signature), code('INVALID_SESSION_SIGNATURE'));
  const plan = structuredClone(f.saved); plan.capsule.session.plan.level++;
  await assert.rejects(verify(f, plan), code('SESSION_PLAN_MISMATCH'));
  const media = structuredClone(f.saved); media.capsule.content.release.body.pack.copy.transfer = 'Different transfer activity';
  await assert.rejects(verify(f, media), code('INVALID_SIGNATURE'));
  const substitute = structuredClone(f.saved);
  substitute.capsule.content.release = await content.release(await content.pick('memory', '9-11', 'en'));
  await assert.rejects(verify(f, substitute), code('OFFLINE_CONTENT_MISMATCH'));
});

test('missing, truncated and invalid journals cannot pass by keeping or recomputing their digest', async () => {
  const f = await fixture();
  await assert.rejects(verify(f, f.saved, []), code('OFFLINE_JOURNAL_CHANGED'));
  await assert.rejects(verify(f, { ...f.saved, journalHash: 'invalid' }), code('OFFLINE_JOURNAL_CHANGED'));
  const broken = f.events.map(event => ({ ...event, seq: 2 }));
  await assert.rejects(verify(f, { ...f.saved, journalHash: await hashObject(broken) }, broken));
  const unknown = [{ ...f.events[0], type: 'invented-event' }];
  await assert.rejects(verify(f, { ...f.saved, journalHash: await hashObject(unknown) }, unknown));
  const tooMany = Array.from({ length: 3001 }, () => f.events[0]);
  await assert.rejects(verify(f, { ...f.saved, journalHash: await hashObject(tooMany) }, tooMany), code('OFFLINE_JOURNAL_CHANGED'));
});

test('offline reopening cannot renew expired authorization or clear persisted clock and handover faults', async () => {
  const f = await fixture();
  await assert.rejects(verify(f, f.saved, f.events, Date.parse(f.saved.capsule.session.continuation_grant.body.recordUntil)), code('SESSION_AUTHORIZATION_EXPIRED'));
  await assert.rejects(verify(f, { ...f.saved, checkpoint: { highest: now + 2000, fault: null } }), code('SESSION_CLOCK_CHANGED'));
  for (const fault of ['SESSION_CLOCK_CHANGED', 'SESSION_REPLACED']) await assert.rejects(verify(f, { ...f.saved, checkpoint: { highest: now, fault } }), code(fault));
  await assert.rejects(verify(f, { ...f.saved, checkpoint: { highest: NaN, fault: null } }));
});

test('a live inactive, replaced or mismatched status cannot prepare an offline entry', async () => {
  const f = await fixture();
  for (const change of [{ canContinue: false }, { historyOnly: true }, { state: 'aborted' }, { id: randomUUID() }]) {
    assert.throws(() => makeOfflineCapsule(f.parent.family_id, f.deviceId, f.started.session, { ...f.proof, status: { ...f.proof.status, ...change } }, f.media), code('OFFLINE_NOT_AUTHORIZED'));
  }
});

test('a restored active stimulus is excluded once, then exact duplicate uploads finalize only once', async () => {
  const f = await fixture();
  // The service received an event before the connection disappeared.
  await api.append(f.principal, f.started.session.id, { events: f.events });
  const verified = await verify(f); let local = f.events, removals = 0;
  const runtime = new SessionRuntime(verified.capsule.session, {
    now: () => 100, uuid: randomUUID, authorize: actions => verified.clock.assert(actions),
    journal: { load: async () => local, save: async events => { local = events; }, remove: async () => { removals++; } },
    send: async events => api.append(f.principal, f.started.session.id, { events }),
    finalize: async lastSeq => await api.finalize(f.principal, f.started.session.id, { lastSeq }) as Result,
  });
  await runtime.initialize();
  assert.equal(runtime.events.length, 2); assert.equal(runtime.events[1].type, 'interrupt');
  assert.equal(runtime.state.invalidations.length, 1); assert.equal(runtime.state.results.length, 0);
  await runtime.record([{ type: 'end', reason: 'child_stopped' }]);
  const result = await runtime.sync(); assert.ok(result); await runtime.sync();
  assert.equal(removals, 1);
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM events WHERE session_id=$1', [f.started.session.id])).rows[0].n, 3);
});

test('clock checkpoints preserve high water and faults across process restart, including invalid device clocks', async () => {
  const f = await fixture(), grant = f.started.session.continuation_grant!;
  let wall = now, mono = 0;
  const clock = new ContinuationClock(grant, () => wall, () => mono);
  wall += 20000; mono += 20000;
  const point = clock.checkpoint(); assert.equal(point.highest, wall);
  const smallSkew = new ContinuationClock(grant, () => wall - 500, () => 0, point);
  assert.equal(smallSkew.remaining(), Date.parse(grant.body.recordUntil) - point.highest);
  const restarted = new ContinuationClock(grant, () => wall - 2000, () => 0, point);
  assert.throws(() => restarted.remaining(), code('SESSION_CLOCK_CHANGED'));
  const again = new ContinuationClock(grant, () => wall + 5000, () => 0, restarted.checkpoint());
  assert.throws(() => again.remaining(), code('SESSION_CLOCK_CHANGED'));
  assert.doesNotThrow(() => again.assert([{ type: 'end', reason: 'time_limit' }]));
  wall = NaN;
  const invalid = clock.checkpoint(); assert.equal(invalid.highest, point.highest); assert.equal(invalid.fault, 'SESSION_CLOCK_CHANGED');
});

test('only an explicit network failure qualifies for offline fallback, never HTTP denial or a decoding defect', () => {
  assert.equal(isNetworkFailure(new NetworkUnavailable()), true);
  for (const failure of [new TypeError('Failed to fetch'), new SyntaxError('Invalid JSON'), {status:401}, {status:403}, {status:409}, {status:500}, new Error('NETWORK_UNAVAILABLE')]) assert.equal(isNetworkFailure(failure), false);
});
