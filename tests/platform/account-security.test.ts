import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { setupSchema } from '../../packages/contracts/index.ts';
import { newPasswordSchema } from '../../packages/contracts/account-security.ts';
import { AccountSecurityClient } from '../../packages/session-runtime/account-security-client.ts';
import type { AccountSecurity } from '../../packages/contracts/account-security.ts';

let db: Database, api: FocusService, content: Awaited<ReturnType<typeof createLocalContent>>, authority: Awaited<ReturnType<typeof createSessionAuthority>>;
let clock = Date.now();
const denied = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
before(async () => { db = await openDatabase('memory://'); await migrate(db); content = await createLocalContent(db, { now: () => clock }); authority = await createSessionAuthority(db); api = service(db, () => clock, content, authority); });
after(() => db.close());
async function fixture() {
  const credentials = { name: 'Account-' + randomUUID().slice(0, 8), password: 'Synthetic-old-passphrase!' };
  const auth = await api.setup({ ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
  const p = (await api.authenticate(auth.value))!;
  const c = await api.addChild(p, { alias: 'Synthetic Child', ageBand: '9-11', locale: 'en', localConfirmation: true });
  return { credentials, auth, p, c };
}
const next = 'A new synthetic passphrase!';

test('account overview is parent scoped, family bound and exposes counts without credentials or device identifiers', async () => {
  const f = await fixture(); await api.login(f.credentials, 'native');
  const overview = await api.accountSecurity(f.p);
  assert.equal(overview.familyId, f.p.family_id); assert.deepEqual(overview.active, { parent: { web: 1, native: 1 }, child: { web: 0, native: 0 } });
  for (const secret of [f.p.token_hash, f.auth.value, f.auth.csrf, f.credentials.password, 'device_id', 'password_hash']) assert.ok(!JSON.stringify(overview).includes(secret));
  const other = await fixture(); assert.notEqual((await api.accountSecurity(other.p)).familyId, overview.familyId);
  const entered = await api.enterChild(f.p, f.c.id), cp = (await api.authenticate(entered.auth.value))!;
  await assert.rejects(api.accountSecurity(cp), denied('PARENT_REQUIRED'));
  await assert.rejects(api.changePassword(cp, { currentPassword: f.credentials.password, newPassword: next, acknowledged: true }), denied('PARENT_REQUIRED'));
});

test('new passwords permit passphrases and Unicode while rejecting short values, extras and missing confirmation', async () => {
  assert.ok(newPasswordSchema.safeParse('a memorable phrase').success);
  assert.ok(newPasswordSchema.safeParse('😀'.repeat(15)).success); assert.equal(newPasswordSchema.safeParse('😀'.repeat(8)).success, false);
  assert.equal(newPasswordSchema.safeParse('x'.repeat(129)).success, false);
  assert.equal(setupSchema.safeParse({ name: 'short', password: '1234567890', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }).success, false);
  const f = await fixture();
  await assert.rejects(api.changePassword(f.p, { currentPassword: f.credentials.password, newPassword: next }));
  await assert.rejects(api.logoutAll(f.p, { currentPassword: f.credentials.password, acknowledged: true, familyId: randomUUID() }));
  await assert.rejects(api.changePassword(f.p, { currentPassword: f.credentials.password, newPassword: f.credentials.password, acknowledged: true }), denied('PASSWORD_UNCHANGED'));
  assert.ok(await api.authenticate(f.auth.value));
});

test('password change atomically ends Web, native and child credentials while preserving family records and unfinished practice', async () => {
  const f = await fixture(), native = await api.login(f.credentials, 'native');
  const started = await api.start(f.p, f.c.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
  const parentAuth = await api.login(f.credentials), p = (await api.authenticate(parentAuth.value))!;
  const before = (await api.report(p, f.c.id)).child;
  await api.changePassword(p, { currentPassword: f.credentials.password, newPassword: next, acknowledged: true });
  for (const [token, transport] of [[native.value, 'native'], [started.auth.value, 'web'], [parentAuth.value, 'web']] as const) assert.equal(await api.authenticate(token, transport), null);
  await assert.rejects(api.login(f.credentials), denied('LOGIN_FAILED'));
  const current = (await api.authenticate((await api.login({ ...f.credentials, password: next })).value))!;
  assert.deepEqual((await api.report(current, f.c.id)).child, before);
  assert.equal((await api.recoverySpace(current, f.c.id, { deviceId: started.session.device_id })).active?.id, started.session.id);
  assert.ok((await api.accountSecurity(current)).passwordChangedAt);
});

test('sign out everywhere requires the current password and does not change it or another family', async () => {
  const f = await fixture(), other = await fixture();
  await assert.rejects(api.logoutAll(f.p, { currentPassword: 'incorrect password', acknowledged: true }), denied('PASSWORD_REJECTED'));
  assert.ok(await api.authenticate(f.auth.value));
  await api.logoutAll(f.p, { currentPassword: f.credentials.password, acknowledged: true });
  assert.equal(await api.authenticate(f.auth.value), null); assert.ok(await api.authenticate(other.auth.value));
  const p = (await api.authenticate((await api.login(f.credentials)).value))!;
  assert.equal((await api.accountSecurity(p)).passwordChangedAt, null);
});

test('only a recently authenticated creator can delete the whole family and every server-side child record', async () => {
  const f = await fixture(), other = await fixture();
  await api.observe(f.p, f.c.id, { task: 'search', context: 'packing', prompts: 1, childChoice: true }, randomUUID());
  const childAccess = await api.start(f.p, f.c.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
  const child = (await api.authenticate(childAccess.auth.value))!;
  const creator = (await api.authenticate((await api.login(f.credentials)).value))!;
  const invite = await api.inviteMember(creator, { childIds: [f.c.id], acknowledged: true }, randomUUID());
  const joined = await api.join({ code: invite.code, loginName: 'helper', displayName: 'Synthetic helper', password: 'Synthetic-helper-passphrase!', acknowledgedLocalUse: true });
  const helper = (await api.authenticate(joined.value))!;
  await db.query(`INSERT INTO guardian_consents(id,family_id,child_id,owner_member_id,provider,verification_ref_hash,country,age_band,locale,purpose,notice_version,notice_sha256,release_scope_identity,verified_at,granted_at,expires_at)
    VALUES($1,$2,$3,$4,'synthetic-provider',$5,'ZZ','9-11','en','family-practice','synthetic-1',$6,'synthetic-scope',$7,$7,$8)`,
    [randomUUID(),f.p.family_id,f.c.id,creator.member_id,'a'.repeat(64),'b'.repeat(64),new Date(clock).toISOString(),new Date(clock+3600_000).toISOString()]);
  const input = { currentPassword: f.credentials.password, familyName: f.credentials.name, acknowledged: true };
  await assert.rejects(api.deleteFamily(child, input), denied('PARENT_REQUIRED'));
  await assert.rejects(api.deleteFamily(helper, input), denied('OWNER_REQUIRED'));
  await assert.rejects(api.deleteFamily(creator, { ...input, familyName: 'another family' }), denied('FAMILY_NAME_MISMATCH'));
  await assert.rejects(api.deleteFamily(creator, { ...input, currentPassword: 'wrong password' }), denied('PASSWORD_REJECTED'));
  clock += 11 * 60_000;
  await assert.rejects(api.deleteFamily(creator, input), denied('REAUTH_REQUIRED'));
  clock -= 11 * 60_000;
  assert.equal((await api.me(creator)).children.length, 1);
  assert.deepEqual(await api.deleteFamily(creator, input), { ok: true, signInRequired: true });
  assert.equal(await api.authenticate(childAccess.auth.value), null);
  assert.equal(await api.authenticate(joined.value), null);
  assert.equal(await api.authenticate(f.auth.value), null);
  for (const [table, column, id] of [
    ['families','id',f.p.family_id], ['children','family_id',f.p.family_id],
    ['auth_sessions','family_id',f.p.family_id], ['local_confirmations','family_id',f.p.family_id],
    ['family_members','family_id',f.p.family_id], ['observations','child_id',f.c.id],
    ['sessions','child_id',f.c.id], ['guardian_consents','family_id',f.p.family_id],
  ]) {
    const rows = await db.query<{ n: number }>(`SELECT count(*)::int n FROM ${table} WHERE ${column}=$1`, [id]);
    assert.equal(rows.rows[0].n, 0, table);
  }
  assert.equal((await api.me(other.p)).children.length, 1);
  await assert.rejects(api.login(f.credentials), denied('LOGIN_FAILED'));
});

test('revoked principals cannot perform deferred reads, writes or child credential rotation', async () => {
  const f = await fixture(); await api.logout(f.p);
  for (const action of [() => api.me(f.p), () => api.report(f.p, f.c.id), () => api.parentGuide(f.p, f.c.id), () => api.enterChild(f.p, f.c.id),
    () => api.start(f.p, f.c.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID()),
    () => api.observe(f.p, f.c.id, { task: 'search', context: 'packing', prompts: 1, childChoice: true }, randomUUID()),
    () => api.deleteChild(f.p, f.c.id)]) await assert.rejects(action(), denied('UNAUTHENTICATED'));
  assert.equal((await db.query('SELECT id FROM sessions WHERE child_id=$1', [f.c.id])).rows.length, 0);
});

test('concurrent credential rotations have one winner and cannot restore parent access', async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled([api.start(f.p, f.c.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID()), api.enterChild(f.p, f.c.id)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(x => x.status === 'rejected') as PromiseRejectedResult; assert.equal(rejected.reason.code, 'UNAUTHENTICATED');
  assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM auth_sessions WHERE family_id=$1 AND scope='parent'", [f.p.family_id])).rows[0].n, 0);
});

test('password checks commit a shared per-family cooldown and reset after the cooldown', async () => {
  const f = await fixture();
  for (let i = 0; i < 7; i++) await assert.rejects(api.logoutAll(f.p, { currentPassword: 'incorrect password', acknowledged: true }), denied('PASSWORD_REJECTED'));
  const restarted = service(db, () => clock, content, authority);
  await assert.rejects(restarted.login({ ...f.credentials, password: 'incorrect' }), denied('LOGIN_FAILED'));
  await assert.rejects(restarted.changePassword(f.p, { currentPassword: f.credentials.password, newPassword: next, acknowledged: true }), denied('ACCOUNT_LOCKED'));
  await assert.rejects(restarted.login(f.credentials), denied('LOGIN_FAILED'));
  clock += 15 * 60000 + 1;
  assert.ok(await restarted.login(f.credentials));
  assert.equal((await db.query<{ auth_failures: number }>('SELECT auth_failures FROM families WHERE id=$1', [f.p.family_id])).rows[0].auth_failures, 0);
});

test('a failure during all-session revocation rolls back the new password and retains the old credentials', async () => {
  const f = await fixture();
  const broken: Database = { ...db, transaction: fn => db.transaction(tx => fn({ query: (sql, values) => sql === 'DELETE FROM auth_sessions WHERE family_id=$1' ? Promise.reject(new Error('synthetic revocation failure')) : tx.query(sql, values) })) };
  await assert.rejects(service(broken, () => clock, content, authority).changePassword(f.p, { currentPassword: f.credentials.password, newPassword: next, acknowledged: true }), /synthetic revocation failure/);
  assert.ok(await api.authenticate(f.auth.value)); assert.ok(await api.login(f.credentials));
  await assert.rejects(api.login({ ...f.credentials, password: next }), denied('LOGIN_FAILED'));
});

const overview: AccountSecurity = { version: 'account-security-1', familyId: 'synthetic-family', passwordChangedAt: null, active: { parent: { web: 1, native: 0 }, child: { web: 0, native: 0 } } };
test('account client refuses a mismatched family and clears inaccessible account details', async () => {
  const client = new AccountSecurityClient('another-family', async <T>() => overview as T, () => {}); await client.load(); assert.equal(client.state.data, null);
  const deniedClient = new AccountSecurityClient(overview.familyId, async () => { throw { code: 'UNAUTHENTICATED' }; }, () => {});
  await deniedClient.load(); assert.equal(deniedClient.state.outcome, 'signin');
});
test('account client blocks double submission, stores no password and does not claim success after a lost response', async () => {
  let writes = 0, reject!: (error: Error) => void;
  const client = new AccountSecurityClient(overview.familyId, async <T>(_path: string, method?: string) => {
    if (!method) return overview as T;
    writes++; return new Promise<T>((_resolve, fail) => { reject = fail; });
  }, () => {});
  await client.load(); const pending = client.submit('password', { currentPassword: 'secret-old', newPassword: next, acknowledged: true });
  await client.submit('password', { currentPassword: 'secret-old', newPassword: next, acknowledged: true }); assert.equal(writes, 1);
  assert.ok(!JSON.stringify(client.state).includes('secret')); reject(new Error('Connection lost')); await pending;
  assert.equal(client.state.outcome, 'uncertain'); assert.equal(client.state.data, null);
});
test('a disposed account view ignores a late response while a successful live view requires a new sign-in', async () => {
  let done!: (value: AccountSecurity) => void, updates = 0;
  const stale = new AccountSecurityClient(overview.familyId, <T>() => new Promise<T>(resolve => { done = value => resolve(value as T); }), () => updates++);
  const pending = stale.load(); stale.dispose(); const before = updates; done(overview); await pending; assert.equal(updates, before);
  const client = new AccountSecurityClient(overview.familyId, async <T>(_path: string, method?: string) => (method ? { ok: true, signInRequired: true } : overview) as T, () => {});
  await client.load(); await client.submit('signout', { currentPassword: 'secret', acknowledged: true }); assert.equal(client.state.outcome, 'signout'); assert.equal(client.state.data, null);
});

test('family deletion client uses DELETE, preserves access for correctable errors and treats lost results as uncertain', async () => {
  const calls: { path: string; method?: string }[] = [];
  let failure: string | null = 'FAMILY_NAME_MISMATCH';
  const make = () => new AccountSecurityClient(overview.familyId, async <T>(path: string, method?: string) => {
    calls.push({ path, method });
    if (!method) return overview as T;
    if (failure) throw { code: failure };
    return { ok: true, signInRequired: true } as T;
  }, () => {});
  const client = make(); await client.load();
  const input = { currentPassword: 'synthetic-passphrase', familyName: 'Synthetic family', acknowledged: true as const };
  await client.submit('delete', input);
  assert.equal(client.state.error, 'FAMILY_NAME_MISMATCH'); assert.ok(client.state.data);
  failure = null; await client.submit('delete', input);
  assert.equal(client.state.outcome, 'delete'); assert.equal(client.state.data, null);
  assert.deepEqual(calls.filter(call => call.method), [{ path: '/family', method: 'DELETE' }, { path: '/family', method: 'DELETE' }]);
  const uncertain = make(); await uncertain.load(); failure = 'NETWORK_UNAVAILABLE';
  await uncertain.submit('delete', input);
  assert.equal(uncertain.state.outcome, 'delete-uncertain'); assert.equal(uncertain.state.data, null);
  assert.ok(!JSON.stringify(uncertain.state).includes(input.currentPassword));
});
