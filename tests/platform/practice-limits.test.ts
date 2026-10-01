import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { DAILY_LIMIT, TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import type { AgeBand, EngineEvent } from '../../packages/task-engine/index.ts';
import { nextFamilyDay } from '../../packages/session-runtime/day-boundary.ts';
import { PracticeLimitClient } from '../../packages/session-runtime/practice-limit-client.ts';
import type { PracticeLimits } from '../../packages/contracts/practice-limits.ts';
let db: Database, api: FocusService, catalogue: Awaited<ReturnType<typeof createLocalContent>>, authority: Awaited<ReturnType<typeof createSessionAuthority>>;
const base = Date.parse('2026-10-01T08:00:00Z'); let clock = base;
const denied = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
before(async () => { db = await openDatabase('memory://'); await migrate(db); catalogue = await createLocalContent(db, { now: () => clock }); authority = await createSessionAuthority(db); api = service(db, () => clock, catalogue, authority); });
after(() => db.close());
async function fixture(ageBand: AgeBand = '6-8', timezone = 'UTC') {
  clock = base;
  const credentials = { name: 'Limits-' + randomUUID().slice(0, 8), password: 'Synthetic-limits-passphrase!' };
  const auth = await api.setup({ ...credentials, timezone, locale: 'en', acknowledgedLocalUse: true });
  const p = (await api.authenticate(auth.value))!;
  const c = await api.addChild(p, { alias: 'Synthetic Child', ageBand, locale: 'en', localConfirmation: true });
  return { credentials, p, c };
}
const login = async (f: Awaited<ReturnType<typeof fixture>>) => (await api.authenticate((await api.login(f.credentials)).value))!;
async function set(f: Awaited<ReturnType<typeof fixture>>, minutes: number) { const current = await api.practiceLimits(f.p, f.c.id); return api.setPracticeLimit(f.p, f.c.id, { minutes, acknowledged: true, effectiveDay: current.nextDay }, `"${current.settingsVersion}"`); }
async function start(f: Awaited<ReturnType<typeof fixture>>, deviceId = randomUUID()) { return api.start(await login(f), f.c.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId }, randomUUID()); }
async function stop(f: Awaited<ReturnType<typeof fixture>>, ms: number) {
  const s = await start(f), p = (await api.authenticate(s.auth.value))!;
  const events: EngineEvent[] = [
    { id: randomUUID(), seq: 1, at: 0, type: 'present', trialId: s.session.plan.trials[0].id, presentation: { frameDeltaMs: 16, assetsReady: true, method: 'raf-pair' } },
    { id: randomUUID(), seq: 2, at: ms, type: 'interrupt', reason: 'pause' },
    { id: randomUUID(), seq: 3, at: ms + 100000, type: 'end', reason: 'child_stopped' },
  ];
  await api.append(p, s.session.id, { events }); await api.finalize(p, s.session.id, { lastSeq: 3 }); return s;
}

test('all four age defaults are read-only, family scoped and children may read only their own plan', async () => {
  for (const age of Object.keys(DAILY_LIMIT) as AgeBand[]) {
    const f = await fixture(age), before = (await db.query('SELECT * FROM children WHERE id=$1', [f.c.id])).rows;
    const overview = await api.practiceLimits(f.p, f.c.id); assert.equal(overview.currentMinutes * 60000, DAILY_LIMIT[age]); assert.equal(overview.availableMs, DAILY_LIMIT[age]);
    assert.equal(overview.next, null); assert.equal(overview.canEdit, true); assert.deepEqual((await db.query('SELECT * FROM children WHERE id=$1', [f.c.id])).rows, before);
    const sibling = await api.addChild(f.p, { alias: 'Sibling', ageBand: age, locale: 'en', localConfirmation: true });
    const child = (await api.authenticate((await api.enterChild(f.p, f.c.id)).auth.value))!;
    assert.equal((await api.practiceLimits(child, f.c.id)).canEdit, false);
    await assert.rejects(api.practiceLimits(child, sibling.id), denied('NOT_FOUND'));
    await assert.rejects(api.setPracticeLimit(child, f.c.id, { minutes: 1, acknowledged: true, effectiveDay: overview.nextDay }, '"1"'), denied('PARENT_REQUIRED'));
    const other = await fixture(); await assert.rejects(api.practiceLimits(other.p, f.c.id), denied('NOT_FOUND'));
  }
});

test('settings enforce age ceiling, whole minutes, confirmation, current parent verification and optimistic version', async () => {
  const f = await fixture(), input = { minutes: 2, acknowledged: true, effectiveDay: '2026-10-02' };
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, input, undefined), denied('VERSION_REQUIRED'));
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, input, '1'), denied('INVALID_VERSION'));
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, { ...input, minutes: 9 }, '"1"'), denied('LIMIT_ABOVE_AGE_MAXIMUM'));
  for (const minutes of [-1, 1.5, 13]) await assert.rejects(api.setPracticeLimit(f.p, f.c.id, { ...input, minutes }, '"1"'));
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, { ...input, acknowledged: false }, '"1"'));
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, { ...input, familyId: randomUUID() }, '"1"'));
  const changed = await set(f, 2); assert.equal(changed.currentMinutes, 8); assert.deepEqual(changed.next, { minutes: 2, day: '2026-10-02' });
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, input, '"1"'), denied('LIMIT_VERSION_CONFLICT'));
  clock += 11 * 60000;
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, input, '"2"'), denied('REAUTH_REQUIRED'));
  assert.equal((await api.practiceLimits(f.p, f.c.id)).settingsVersion, 2);
});

test('new limits take effect at the family day boundary and cannot change an existing signed practice', async () => {
  const f = await fixture('6-8', 'Asia/Shanghai'); const active = await start(f), old = JSON.stringify(active.session.continuation_grant);
  f.p = await login(f); await set(f, 1);
  const today = await api.practiceLimits(f.p, f.c.id); assert.equal(today.reservedMs, 480000); assert.equal(today.availableMs, 0);
  assert.equal(JSON.stringify((await db.query<{ continuation_grant: unknown }>('SELECT continuation_grant FROM sessions WHERE id=$1', [active.session.id])).rows[0].continuation_grant), old);
  assert.equal(Date.parse(active.session.continuation_grant!.body.recordUntil), Math.min(clock + 20 * 60000, nextFamilyDay(clock, 'Asia/Shanghai')));
  clock = nextFamilyDay(clock, 'Asia/Shanghai'); f.p = await login(f);
  const next = await api.practiceLimits(f.p, f.c.id); assert.equal(next.currentMinutes, 1); assert.equal(next.next, null); assert.equal(next.availableMs, 60000);
  const restarted = service(db, () => clock, catalogue, authority); assert.equal((await restarted.practiceLimits(f.p, f.c.id)).currentMinutes, 1);
});

test('repeated starts, pauses and pending handovers do not reset or refund active-time allowance', async () => {
  const f = await fixture(); await set(f, 1); clock = nextFamilyDay(clock, 'UTC'); f.p = await login(f);
  await stop(f, 20000); const one = await api.practiceLimits(f.p, f.c.id); assert.equal(one.confirmedMs, 20000); assert.equal(one.availableMs, 40000);
  const s = await start(f); assert.equal(s.session.budget_ms, 40000);
  const held = await api.practiceLimits(f.p, f.c.id); assert.equal(held.confirmedMs, 20000); assert.equal(held.reservedMs, 40000); assert.equal(held.availableMs, 0);
  const target = randomUUID(), recovery = await api.recoverySpace(f.p, f.c.id, { deviceId: target });
  await api.handover(f.p, f.c.id, s.session.id, { deviceId: target, acknowledged: true }, recovery.active!.etag, randomUUID());
  assert.equal((await api.practiceLimits(f.p, f.c.id)).reservedMs, 40000);
  await assert.rejects(start(f, target), denied('DAILY_LIMIT'));
  assert.equal((await api.recoverySpace(f.p, f.c.id, { deviceId: target })).availableMs, 0);
});

test('a pause blocks new Web and native practice after rollover but permits records and next-day resumption', async () => {
  const f = await fixture(); await set(f, 0); assert.equal((await api.practiceLimits(f.p, f.c.id)).currentMinutes, 8);
  clock = nextFamilyDay(clock, 'UTC'); f.p = await login(f);
  assert.equal((await api.practiceLimits(f.p, f.c.id)).status, 'paused'); await assert.rejects(start(f), denied('PRACTICE_PAUSED'));
  const native = (await api.authenticate((await api.login(f.credentials, 'native')).value, 'native'))!;
  await assert.rejects(api.start(native, f.c.id, { task: 'search', environment: { ...TEST_ENVIRONMENT, platform: 'ios', input: 'touch', deviceClass: 'phone' }, deviceId: randomUUID() }, randomUUID()), denied('PRACTICE_PAUSED'));
  assert.equal((await api.report(f.p, f.c.id)).child.id, f.c.id);
  await set(f, 2); await assert.rejects(start(f), denied('PRACTICE_PAUSED'));
  clock = nextFamilyDay(clock, 'UTC'); f.p = await login(f); const s = await start(f); assert.equal(s.session.budget_ms, 120000);
  const exported = await api.exportChild(f.p, f.c.id); assert.equal(exported.practiceLimits.currentMinutes, 2); assert.equal((exported.sessions[0].daily_limit_snapshot as { minutes: number }).minutes, 2);
});

test('pending plans can be replaced or cancelled without changing today, and two editors cannot silently overwrite', async () => {
  const f = await fixture(); const results = await Promise.allSettled([2, 3].map(minutes => api.setPracticeLimit(f.p, f.c.id, { minutes, acknowledged: true, effectiveDay: '2026-10-02' }, '"1"')));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'LIMIT_VERSION_CONFLICT');
  const replaced = await set(f, 4); assert.equal(replaced.next?.minutes, 4); assert.equal(replaced.currentMinutes, 8);
  const cancelled = await set(f, 8); assert.equal(cancelled.next, null); assert.equal(cancelled.currentMinutes, 8);
});

test('family midnight, DST and stale dates use the server calendar rather than a client clock', async () => {
  const f = await fixture('9-11', 'America/New_York'); clock = Date.parse('2026-11-01T04:30:00Z'); f.p = await login(f);
  const at = await api.practiceLimits(f.p, f.c.id); assert.equal(at.day, '2026-11-01'); assert.equal(at.nextDay, '2026-11-02');
  assert.equal(nextFamilyDay(clock, 'America/New_York'), Date.parse('2026-11-02T05:00:00Z'));
  await api.setPracticeLimit(f.p, f.c.id, { minutes: 3, acknowledged: true, effectiveDay: at.nextDay }, '"1"');
  clock = Date.parse('2026-11-02T05:00:00Z'); f.p = await login(f);
  await assert.rejects(api.setPracticeLimit(f.p, f.c.id, { minutes: 4, acknowledged: true, effectiveDay: at.nextDay }, '"2"'), denied('LIMIT_DAY_CHANGED'));
  assert.equal((await api.practiceLimits(f.p, f.c.id)).currentMinutes, 3);
});

test('withdrawal makes usage read-only and deletion removes settings without leaving child access', async () => {
  const f = await fixture(); await set(f, 2); await api.withdraw(f.p, f.c.id);
  assert.equal((await api.practiceLimits(f.p, f.c.id)).status, 'collection-stopped');
  await assert.rejects(set(f, 3), denied('CONSENT_REVOKED'));
  assert.equal((await api.exportChild(f.p, f.c.id)).practiceLimits.next?.minutes, 2);
  await api.deleteChild(f.p, f.c.id); await assert.rejects(api.practiceLimits(f.p, f.c.id), denied('NOT_FOUND'));
});

const snapshot: PracticeLimits = { version: 'practice-limits-1', childId: 'synthetic-child', ageBand: '6-8', settingsVersion: 1, canEdit: true, collectionActive: true, timezone: 'UTC', day: '2026-10-01', nextDay: '2026-10-02', generatedAt: new Date(base).toISOString(), maximumMinutes: 8, currentMinutes: 8, next: null, confirmedMs: 0, reservedMs: 0, availableMs: 480000, status: 'available' };
test('client rejects mismatched scope and identity and ignores responses after leaving a profile', async () => {
  for (const value of [{ ...snapshot, childId: 'wrong' }, { ...snapshot, canEdit: false }, { ...snapshot, version: 'old' }]) {
    const c = new PracticeLimitClient(snapshot.childId, true, async <T>() => value as T, () => {}); await c.load(); assert.equal(c.state.data, null);
  }
  let done!: (value: PracticeLimits) => void; let updates = 0;
  const c = new PracticeLimitClient(snapshot.childId, true, <T>() => new Promise<T>(resolve => { done = value => resolve(value as T); }), () => updates++);
  const pending = c.load(); c.dispose(); const before = updates; done(snapshot); await pending; assert.equal(updates, before);
});
test('client protects pending writes, clears stale conflict and unknown results, and sends the acknowledged day and version', async () => {
  let writes = 0, reject!: (error: unknown) => void, input: unknown, headers: unknown;
  const c = new PracticeLimitClient(snapshot.childId, true, async <T>(_path: string, method?: string, body?: unknown, head?: unknown) => {
    if (!method) return snapshot as T; writes++; input = body; headers = head; return new Promise<T>((_, fail) => { reject = fail; });
  }, () => {});
  await c.load(); const pending = c.save(2); await c.save(3); assert.equal(writes, 1);
  assert.deepEqual(input, { minutes: 2, acknowledged: true, effectiveDay: '2026-10-02' }); assert.deepEqual(headers, { 'If-Match': '"1"' });
  reject(new Error('lost response')); await pending; assert.equal(c.state.data, null); assert.equal(c.state.saved, false); assert.equal(c.state.error, 'RESULT_UNCONFIRMED');
  await c.load(); const conflict = c.save(3); reject({ code: 'LIMIT_VERSION_CONFLICT' }); await conflict; assert.equal(c.state.data, null); assert.equal(c.state.error, 'LIMIT_VERSION_CONFLICT');
});
