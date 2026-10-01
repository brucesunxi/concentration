import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { memberContext } from '../../apps/api/family-members.ts';
import { FAMILY_TABLES, verifyRuntimeRole } from '../../apps/api/family-isolation.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService, Principal } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { completeEvents } from '../platform/fixtures.ts';
import { supportStudio } from '../../apps/api/support-studio.ts';
import { sectionIds } from '../../packages/family-support/publication.ts';
import type {StudioPrincipal,StudioRole} from '../../apps/api/studio-auth.ts';
import { fileStudioVault, totp,provisionStudioUser,studioAuth } from '../../apps/api/studio-auth.ts';
import { nextFamilyDay } from '../../packages/session-runtime/day-boundary.ts';

// There is deliberately no fallback to DATABASE_URL: this suite is destructive
// inside a new synthetic-only container owned and removed by its test runner.
assert.ok(process.env.FOCUS_PG_TEST_MANIFEST, 'Run npm run test:postgres');
const config = JSON.parse(await readFile(process.env.FOCUS_PG_TEST_MANIFEST!, 'utf8'));
const adminUrl = new URL(config.adminUrl);
assert.equal(adminUrl.hostname, '127.0.0.1'); assert.equal(adminUrl.pathname, '/focus_qa');
for (const pass of [config.runtimePassword, config.studioPassword]) assert.match(pass, /^[a-f0-9]{64}$/);
const runtimeUrl = new URL(adminUrl); runtimeUrl.username = 'focus_family'; runtimeUrl.password = config.runtimePassword;
const studioUrl = new URL(adminUrl); studioUrl.username = 'focus_studio'; studioUrl.password = config.studioPassword;
let admin: Database, db: Database, studio: Database, api: FocusService;
let catalogue: Awaited<ReturnType<typeof createLocalContent>>, authority: Awaited<ReturnType<typeof createSessionAuthority>>;
const dataDir = join(config.root, 'data'), exec = promisify(execFile);
const proof: Record<string, unknown> = { imageId: config.imageId, repoDigests: config.repoDigests, checks: [] };
const noted = (name: string) => (proof.checks as string[]).push(name);
const errorCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
const rejected = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const inFamily = <T>(p: Principal, action: () => Promise<T>) => db.context!(memberContext(p), action);
async function family() {
  const credentials = { name: 'Synthetic-' + randomUUID().slice(0, 8), password: 'Synthetic-postgres-2026!' };
  const auth = await api.setup({ ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
  const parent = (await api.authenticate(auth.value))!;
  const child = await api.addChild(parent, { alias: 'Synthetic Teen', ageBand: '15-17', locale: 'en', localConfirmation: true });
  return { credentials, parent, child, auth };
}
async function login(f: Awaited<ReturnType<typeof family>>) { return (await api.authenticate((await api.login(f.credentials)).value))!; }
before(async () => {
  admin = await openDatabase('memory://', adminUrl.href);
  await Promise.all([migrate(admin), migrate(admin), migrate(admin)]);
  await admin.query(`CREATE ROLE focus_family LOGIN PASSWORD '${config.runtimePassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE ROLE focus_studio LOGIN PASSWORD '${config.studioPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  for (let i = 0; i < 2; i++) await exec(process.execPath, ['scripts/prepare-postgres.ts'], { env: {
    ...process.env, APP_MODE: 'local', DATABASE_MIGRATION_URL: adminUrl.href, FOCUS_DATABASE_ROLE: 'focus_family', FOCUS_STUDIO_DATABASE_ROLE: 'focus_studio', FOCUS_DATA_DIR: dataDir,
  }, timeout: 30000 });
  db = await openDatabase('memory://', runtimeUrl.href); studio = await openDatabase('memory://', studioUrl.href);
  catalogue = await createLocalContent(db, { readOnly: true }); authority = await createSessionAuthority(db, { dataDir, readOnly: true });
  api = service(db, Date.now, catalogue, authority);
  proof.server = (await admin.query('SELECT version() AS version,current_setting(\'server_version_num\') AS number')).rows[0];
});
after(async () => { await Promise.all([db?.close(), studio?.close(), admin?.close()]);
  console.log('POSTGRES_PROOF ' + JSON.stringify(proof));
  if (process.env.FOCUS_PG_EVIDENCE) await writeFile(resolve(process.env.FOCUS_PG_EVIDENCE), JSON.stringify(proof, null, 2) + '\n');
});

test('concurrent migration and repeat preparation preserve one ordered schema and fail closed on elevated runtime identities', async () => {
  assert.deepEqual((await admin.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version')).rows.map(x => x.version), Array.from({ length: 30 }, (_, i) => i + 1));
  await verifyRuntimeRole(db, 'family'); await verifyRuntimeRole(studio, 'studio');
  await admin.query('REVOKE SELECT ON schema_migrations FROM focus_family');
  try { await assert.rejects(verifyRuntimeRole(db, 'family'), /DATABASE_SCHEMA_UPGRADE_REQUIRED/); }
  finally { await admin.query('GRANT SELECT ON schema_migrations TO focus_family'); }
  await admin.query('DELETE FROM schema_migrations WHERE version=30');
  try { await assert.rejects(verifyRuntimeRole(db, 'family'), /DATABASE_SCHEMA_UPGRADE_REQUIRED/); }
  finally { await admin.query('INSERT INTO schema_migrations(version) VALUES(30)'); }
  await admin.query('INSERT INTO schema_migrations(version) VALUES(31)');
  try { await assert.rejects(verifyRuntimeRole(studio, 'studio'), /DATABASE_SCHEMA_UPGRADE_REQUIRED/); }
  finally { await admin.query('DELETE FROM schema_migrations WHERE version=31'); }
  await assert.rejects(verifyRuntimeRole(admin, 'family'), /DATABASE_RUNTIME_ROLE_UNSAFE/);
  await assert.rejects(verifyRuntimeRole(studio, 'family'), /DATABASE_CROSS_ROLE_PRIVILEGE/);
  await assert.rejects(verifyRuntimeRole(db, 'studio'), /DATABASE_CROSS_ROLE_PRIVILEGE/);
  await admin.query('CREATE POLICY unexpected_allow ON children USING(true)');
  try { await assert.rejects(verifyRuntimeRole(db, 'family'), /DATABASE_FAMILY_ISOLATION_REQUIRED/); }
  finally { await admin.query('DROP POLICY unexpected_allow ON children'); }
  noted('concurrent-migrations-and-runtime-role-gates');
});

test('missing context denies every family table; scoped queries with omitted filters isolate families and siblings', async () => {
  const a = await family(), b = await family();
  const sibling = await api.addChild(a.parent, { alias: 'Sibling', ageBand: '6-8', locale: 'zh-CN', localConfirmation: true });
  for (const table of FAMILY_TABLES) assert.deepEqual((await db.query(`SELECT * FROM ${table}`)).rows, [], table);
  assert.deepEqual((await inFamily(a.parent, () => db.query<{ id: string }>('SELECT id FROM families'))).rows.map(x => x.id), [a.parent.family_id]);
  assert.equal((await inFamily(a.parent, () => db.query('SELECT * FROM children'))).rows.length, 2);
  assert.equal((await inFamily(a.parent, () => db.query('UPDATE children SET alias=$1 WHERE id=$2 RETURNING id', ['forbidden', b.child.id]))).rows.length, 0);
  await assert.rejects(inFamily(a.parent, () => db.query('UPDATE children SET family_id=$1 WHERE id=$2', [b.parent.family_id, a.child.id])), errorCode('42501'));
  await assert.rejects(inFamily(a.parent, () => db.query('INSERT INTO observations(id,child_id,task,context,prompts,child_choice,created_at) VALUES($1,$2,$3,$4,0,true,now())', [randomUUID(), b.child.id, 'search', 'packing'])), errorCode('42501'));
  const entered = await api.enterChild(a.parent, a.child.id), childPrincipal = (await api.authenticate(entered.auth.value))!;
  assert.deepEqual((await inFamily(childPrincipal, () => db.query<{ id: string }>('SELECT id FROM children'))).rows.map(x => x.id), [a.child.id]);
  assert.equal((await inFamily(childPrincipal, () => db.query('SELECT * FROM auth_sessions WHERE scope=\'parent\''))).rows.length, 0);
  await assert.rejects(api.lifeSpace(childPrincipal, sibling.id), rejected('NOT_FOUND'));
  await assert.rejects(api.report(b.parent, a.child.id), rejected('NOT_FOUND'));
  noted('no-context-and-omitted-filter-family-sibling-isolation');
});

test('family practice limits serialize editors, preserve reservations and take effect on the family day under runtime roles', async () => {
  const f = await family(), other = await family();
  const before = await api.practiceLimits(f.parent, f.child.id);
  const races = await Promise.allSettled([2, 4].map(minutes => api.setPracticeLimit(f.parent, f.child.id, { minutes, effectiveDay: before.nextDay, acknowledged: true }, '"1"')));
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((races.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'LIMIT_VERSION_CONFLICT');
  const planned = await api.practiceLimits(f.parent, f.child.id);
  assert.equal(planned.currentMinutes, 12); assert.equal(planned.settingsVersion, 2);
  assert.equal((await api.practiceLimits(other.parent, other.child.id)).next, null);
  await assert.rejects(api.setPracticeLimit(other.parent, f.child.id, { minutes: 1, effectiveDay: before.nextDay, acknowledged: true }, '"2"'), rejected('NOT_FOUND'));
  await assert.rejects(inFamily(f.parent, () => db.query('UPDATE children SET daily_limit_minutes=13 WHERE id=$1', [f.child.id])), errorCode('23514'));
  const future = service(db, () => nextFamilyDay(Date.now(), 'UTC') + 1000, catalogue, authority);
  const parent = (await future.authenticate((await future.login(f.credentials)).value))!;
  const started = await future.start(parent, f.child.id, { task: 'search', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID());
  assert.equal(started.session.budget_ms, planned.next!.minutes * 60000);
  const readParent = (await future.authenticate((await future.login(f.credentials)).value))!;
  const current = await future.practiceLimits(readParent, f.child.id);
  assert.equal(current.reservedMs, started.session.budget_ms); assert.equal(current.availableMs, 0); assert.equal(current.next, null);
  const exported = await future.exportChild(readParent, f.child.id);
  assert.equal((exported.sessions[0].daily_limit_snapshot as { minutes: number }).minutes, planned.next!.minutes);
  noted('practice-limits-concurrency-rls-day-boundary-and-reservations');
});

test('pooled parallel requests and failed transactions cannot carry another family context', async () => {
  const a = await family(), b = await family();
  await Promise.all(Array.from({ length: 80 }, async (_, i) => {
    const f = i % 2 ? a : b;
    const rows = await inFamily(f.parent, () => db.transaction(async tx => { await tx.query('SELECT pg_sleep(0.005)'); return (await tx.query<{ id: string }>('SELECT id FROM families')).rows; }));
    assert.deepEqual(rows.map(x => x.id), [f.parent.family_id]);
  }));
  await assert.rejects(inFamily(a.parent, () => db.transaction(async tx => { await tx.query('UPDATE children SET alias=$1', ['rolled-back']); await tx.query('SELECT 1/0'); })), errorCode('22012'));
  assert.equal((await api.me(a.parent)).children[0].alias, a.child.alias);
  assert.equal((await db.query('SELECT * FROM families')).rows.length, 0);
  assert.equal((await inFamily(b.parent, () => db.query<{ n: number }>('SELECT count(*)::int n FROM families'))).rows[0].n, 1);
  noted('80-parallel-contexts-and-rollback-clearance');
});

test('registration is atomic when credential insertion fails', async () => {
  const broken: Database = { ...db, transaction: fn => db.transaction(tx => fn({ query: (sql, params) => sql.startsWith('INSERT INTO auth_sessions') ? Promise.reject(new Error('synthetic token failure')) : tx.query(sql, params) })) };
  const name = 'Atomic-' + randomUUID().slice(0, 8);
  await assert.rejects(service(broken, Date.now, catalogue, authority).setup({ name, password: 'Synthetic-atomic-2026!', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }), /synthetic token failure/);
  assert.equal((await admin.query('SELECT id FROM families WHERE name=$1', [name])).rows.length, 0);
  noted('atomic-registration');
});

test('all fourteen populated family tables isolate omitted filters, including verified consent evidence', async () => {
  async function populate() {
    const f = await family();
    await admin.query(`INSERT INTO guardian_consents(id,family_id,child_id,owner_member_id,provider,verification_ref_hash,country,age_band,locale,purpose,notice_version,notice_sha256,release_scope_identity,verified_at,granted_at,expires_at)
      VALUES($1,$2,$3,$4,'synthetic-verifier',$5,'ZZ','15-17','en','family-practice','synthetic-1',$6,'local-development',now(),now(),now()+interval '1 day')`,
      [randomUUID(),f.parent.family_id,f.child.id,f.parent.member_id,createHash('sha256').update(randomUUID()).digest('hex'),'a'.repeat(64)]);
    await api.inviteMember(f.parent,{childIds:[f.child.id],acknowledged:true},randomUUID());
    const goal = (await api.createLifeGoal(f.parent, f.child.id, { contentHash:(await api.lifeSpace(f.parent,f.child.id)).content.hash,intent: 'suggest', templateId: 'steps', support: 'ask-first' }, randomUUID())).goal;
    await api.observe(f.parent, f.child.id, { task: 'search', context: 'packing', prompts: 0, childChoice: true }, randomUUID());
    const { session, auth } = await api.start(f.parent, f.child.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
    const cp = (await api.authenticate(auth.value))!;
    await api.append(cp, session.id, { events: completeEvents(session.plan).slice(0, 1) });
    const p = await login(f), target = randomUUID(), preview = await api.recoverySpace(p, f.child.id, { deviceId: target });
    await api.handover(p, f.child.id, session.id, { deviceId: target, acknowledged: true }, preview.active!.etag, randomUUID());
    return { ...f, parent: p, session, goal };
  }
  const a = await populate(), b = await populate();
  const fields = { families: ['id', a.parent.family_id], children: ['id', a.child.id], auth_sessions: ['family_id', a.parent.family_id], local_confirmations: ['family_id', a.parent.family_id],
    sessions: ['id', a.session.id], events: ['session_id', a.session.id], observations: ['child_id', a.child.id], life_goals: ['id', a.goal.id], life_goal_actions: ['goal_id', a.goal.id], session_handovers: ['session_id', a.session.id], family_members:['family_id',a.parent.family_id], family_invitations:['family_id',a.parent.family_id], family_member_audit:['family_id',a.parent.family_id], guardian_consents:['family_id',a.parent.family_id] };
  for (const table of FAMILY_TABLES) {
    const rows = (await inFamily(a.parent, () => db.query(`SELECT * FROM ${table}`))).rows;
    assert.ok(rows.length > 0, table); const [field, id] = fields[table];
    for (const row of rows) assert.equal(row[field], id, table);
    assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length, 0, table);
  }
  await assert.rejects(inFamily(a.parent, () => db.query(`INSERT INTO auth_sessions(token_hash,csrf,family_id,child_id,scope,expires_at,member_id)
    VALUES($1,'synthetic',$2,$3,'child',now()+interval '1 hour',$4)`, [randomUUID(), a.parent.family_id, b.child.id,a.parent.member_id])), errorCode('42501'));
  const recovered = await api.recover(a.parent, a.child.id, a.session.id, { deviceId: a.session.device_id });
  assert.equal(recovered.session.closed_reason, 'device_handover');
  noted('thirteen-populated-tables-and-cross-family-child-token');
});

test('supporting parents remain pending, child scoped and unable to widen permissions through the database', async () => {
  const f=await family(),sibling=await api.addChild(f.parent,{alias:'Private sibling',ageBand:'6-8',locale:'en',localConfirmation:true});
  const goal=await api.createLifeGoal(f.parent,f.child.id,{contentHash:(await api.lifeSpace(f.parent,f.child.id)).content.hash,intent:'suggest',templateId:'return',support:'ask-first'},randomUUID());
  assert.equal((await inFamily(f.parent,()=>db.query('SELECT id FROM life_goals'))).rows.length,1);
  const invite=await api.inviteMember(f.parent,{childIds:[f.child.id],acknowledged:true},randomUUID());
  const helper={code:invite.code,loginName:'supporting',displayName:'Synthetic co-parent',password:'Synthetic-supporting-2026!',acknowledgedLocalUse:true};
  const joined=await api.join(helper,'native');let p=(await api.authenticate(joined.value,'native'))!;
  assert.deepEqual((await api.me(p)).children,[]);
  assert.deepEqual((await api.familyMembers(p)).members[0].childIds,[]);
  assert.deepEqual((await inFamily(p,()=>db.query('SELECT id FROM children'))).rows,[]);
  await assert.rejects(inFamily(p,()=>db.query("UPDATE family_members SET state='active' WHERE id=$1",[p.member_id])),errorCode('42501'));
  await api.actMember(f.parent,p.member_id,{action:'approve',acknowledged:true},'"1"');p=(await api.authenticate(joined.value,'native'))!;
  assert.deepEqual((await inFamily(p,()=>db.query<{id:string}>('SELECT id FROM children'))).rows.map(x=>x.id),[f.child.id]);
  assert.equal((await api.me(p)).children[0].consentActive,true);
  assert.deepEqual((await inFamily(p,()=>db.query<{child_id:string}>('SELECT child_id FROM local_confirmations'))).rows.map(x=>x.child_id),[f.child.id]);
  assert.deepEqual((await inFamily(p,()=>db.query('UPDATE local_confirmations SET withdrawn_at=now() WHERE child_id=$1 RETURNING id',[f.child.id]))).rows,[]);
  assert.deepEqual((await inFamily(p,()=>db.query<{id:string}>('SELECT id FROM family_members'))).rows.map(x=>x.id),[p.member_id]);
  for(const table of ['family_invitations','family_member_audit','life_goals','life_goal_actions'])assert.deepEqual((await inFamily(p,()=>db.query(`SELECT * FROM ${table}`))).rows,[]);
  await assert.rejects(inFamily(p,()=>db.query('UPDATE family_members SET child_ids=$2 WHERE id=$1',[p.member_id,[f.child.id,sibling.id]])),errorCode('42501'));
  await assert.rejects(api.report(p,sibling.id),rejected('NOT_FOUND'));
  await api.changePassword(p,{currentPassword:helper.password,newPassword:'Another-supporting-passphrase!',acknowledged:true});
  const current=(await api.authenticate((await api.login({...f.credentials,memberLogin:'supporting',password:'Another-supporting-passphrase!'},'native')).value,'native'))!;
  assert.equal((await api.report(current,f.child.id)).child.id,f.child.id);
  const childAccess=await api.enterChild(current,f.child.id);const cp=(await api.authenticate(childAccess.auth.value,'native'))!;
  assert.equal((await api.lifeSpace(cp,f.child.id)).goals[0].id,goal.goal.id);
  await api.actMember(f.parent,p.member_id,{action:'revoke',acknowledged:true},'"2"');
  assert.equal(await api.authenticate(childAccess.auth.value,'native'),null);
  await assert.rejects(api.me(cp),rejected('UNAUTHENTICATED'));
  assert.ok(await api.authenticate(f.auth.value));
  noted('pending-members-scope-write-guard-independent-password-and-revocation');
});

test('a terminated database connection rolls back and the pool recovers without retaining context', async () => {
  const a = await family();
  await assert.rejects(inFamily(a.parent, () => db.transaction(async tx => {
    await tx.query('UPDATE children SET alias=$1 WHERE id=$2', ['uncommitted', a.child.id]);
    const { pid } = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0];
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await tx.query('SELECT 1');
  })));
  assert.equal((await api.me(a.parent)).children[0].alias, a.child.alias);
  assert.equal((await db.query('SELECT * FROM families')).rows.length, 0);
  noted('terminated-connection-rollback-and-pool-recovery');
});

test('real row locks serialize duplicate observation, child entry, event ingest and finalization', async () => {
  const f = await family(), key = randomUUID(), observation = { task: 'search', context: 'packing', prompts: 1, childChoice: true };
  const saved = await Promise.all(Array.from({ length: 12 }, () => api.observe(f.parent, f.child.id, observation, key)));
  assert.equal(new Set(saved.map(x => x.id)).size, 1);
  const entries = await Promise.allSettled([api.enterChild(f.parent, f.child.id), api.enterChild(f.parent, f.child.id)]);
  assert.equal(entries.filter(x => x.status === 'fulfilled').length, 1);
  const { session, auth } = await api.start(await login(f), f.child.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
  const cp = (await api.authenticate(auth.value))!, events = completeEvents(session.plan);
  await Promise.all([api.append(cp, session.id, { events }), api.append(cp, session.id, { events })]);
  const finished = await Promise.all(Array.from({ length: 8 }, () => api.finalize(cp, session.id, { lastSeq: events.length })));
  for (const result of finished) assert.deepEqual(result, finished[0]);
  const report = await api.report(await login(f), f.child.id);
  assert.equal(report.child.completedSessions, 1); assert.equal(report.child.course.unit, 1); assert.equal(report.observationCount, 1);
  noted('concurrent-observation-entry-ingest-finalization');
});

test('life goals use the same scope, and withdrawal/deletion reject delayed writes before deduplication', async () => {
  const f = await family(), input = { contentHash:(await api.lifeSpace(f.parent,f.child.id)).content.hash,intent: 'suggest', templateId: 'steps', support: 'ask-first' }, key = randomUUID();
  const proposals = await Promise.all([api.createLifeGoal(f.parent, f.child.id, input, key), api.createLifeGoal(f.parent, f.child.id, input, key)]);
  assert.equal(proposals[0].goal.id, proposals[1].goal.id);
  const { session, auth } = await api.start(f.parent, f.child.id, { task: 'stop', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
  const cp = (await api.authenticate(auth.value))!, events = completeEvents(session.plan).slice(0, 1);
  await api.append(cp, session.id, { events });
  const p = await login(f); await api.withdraw(p, f.child.id);
  assert.equal(await api.authenticate(auth.value), null);
  await assert.rejects(api.append(cp, session.id, { events }), rejected('UNAUTHENTICATED'));
  assert.equal((await api.lifeSpace(p, f.child.id)).collectionActive, false);
  const exported = await api.exportChild(p, f.child.id); assert.equal(exported.life.goals.length, 1); assert.equal(exported.sessions.length, 1);
  await api.deleteChild(p, f.child.id);
  for (const table of ['children', 'sessions', 'observations', 'local_confirmations', 'guardian_consents', 'life_goals']) {
    const column = table === 'children' ? 'id' : 'child_id';
    assert.equal((await admin.query(`SELECT * FROM ${table} WHERE ${column}=$1`, [f.child.id])).rows.length, 0);
  }
  await assert.rejects(api.append(cp, session.id, { events }), rejected('UNAUTHENTICATED'));
  noted('life-goals-withdraw-delete-delayed-upload');
});

test('runtime roles cannot edit schema, bypass RLS, read the other surface or mutate protected content', async () => {
  for (const statement of ['CREATE TABLE public.forbidden(id int)', 'TRUNCATE children', 'SELECT * FROM studio_users', 'DELETE FROM content_releases', 'DELETE FROM schema_migrations', "SELECT focus_revoke_recalled_sessions('missing')"]) await assert.rejects(db.query(statement), errorCode('42501'));
  await assert.rejects(studio.query('SELECT * FROM families'), errorCode('42501'));
  await assert.rejects(studio.query('UPDATE session_authorities SET id=id'), errorCode('42501'));
  await assert.rejects(db.transaction(async tx => { await tx.query('SET LOCAL row_security=off'); await tx.query('SELECT * FROM children'); }), errorCode('42501'));
  await assert.rejects(db.query('SET ROLE focus_migration'), errorCode('42501'));
  noted('ddl-bypass-and-cross-surface-denied');
});

test('password rotation and in-flight logins serialize without leaving an old-password credential alive', async () => {
  const f = await family(), newPassword = 'New synthetic postgres passphrase!';
  const pending = await Promise.allSettled([
    api.login(f.credentials),
    api.changePassword(f.parent, { currentPassword: f.credentials.password, newPassword, acknowledged: true }),
    api.login(f.credentials, 'native'),
    api.enterChild(f.parent, f.child.id),
  ]);
  // A concurrent enter can win the one-use parent token. In that case retry the
  // password change from a fresh, explicitly authenticated parent identity.
  if (pending[1].status === 'rejected') {
    assert.equal((pending[1] as PromiseRejectedResult).reason.code, 'UNAUTHENTICATED');
    await api.changePassword(await login(f), { currentPassword: f.credentials.password, newPassword, acknowledged: true });
  }
  for (const index of [0, 2] as const) {
    const result = pending[index]; if (result.status === 'fulfilled') assert.equal(await api.authenticate((result.value as { value: string }).value, index === 2 ? 'native' : 'web'), null);
  }
  assert.equal((await admin.query('SELECT token_hash FROM auth_sessions WHERE family_id=$1', [f.parent.family_id])).rows.length, 0);
  await assert.rejects(api.login(f.credentials), rejected('LOGIN_FAILED'));
  const fresh = (await api.authenticate((await api.login({ ...f.credentials, password: newPassword })).value))!;
  assert.equal((await api.accountSecurity(fresh)).active.parent.web, 1);
  await api.logoutAll(fresh, { currentPassword: newPassword, acknowledged: true });
  await assert.rejects(api.addChild(fresh, { alias: 'Rejected', ageBand: '6-8', locale: 'en', localConfirmation: true }), rejected('UNAUTHENTICATED'));
  noted('password-login-child-rotation-and-all-signout-races');
});

test('content recall revokes through a fixed function without giving studio access to family data', async () => {
  const f = await family(); const { session, auth } = await api.start(f.parent, f.child.id, { task: 'memory', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
  const hash = session.plan.content!.sha256, cp = (await api.authenticate(auth.value))!;
  await assert.rejects(studio.query('SELECT focus_revoke_recalled_sessions($1)', [hash]), errorCode('42501'));
  const studioContent = await createLocalContent(studio, { readOnly: true, delegatedRecall: true });
  await studioContent.recall(hash, 'synthetic-publisher', 'Synthetic recall verification');
  await studioContent.recall(hash, 'synthetic-publisher', 'Synthetic recall verification');
  assert.equal((await admin.query<{ state: string }>('SELECT state FROM sessions WHERE id=$1', [session.id])).rows[0].state, 'revoked');
  await assert.rejects(api.append(cp, session.id, { events: completeEvents(session.plan).slice(0, 1) }), errorCode('CONTENT_RECALLED'));
  await assert.rejects(studio.query('SELECT * FROM sessions'), errorCode('42501'));
  noted('studio-recall-without-family-access');
});

test('family support publication uses separate database roles and serializes recall with goal writes',async()=>{
  const f=await family(),vault=fileStudioVault(dataDir),auth=studioAuth(studio,vault),content=await createLocalContent(studio,{readOnly:true}),editorial=supportStudio(studio,content,auth),users:Record<string,StudioPrincipal>={};
  for(const [label,role] of [['editor','editor'],['method','method-reviewer'],['zh','language-reviewer'],['en','language-reviewer'],['publisher','publisher']] as [string,StudioRole][]){
    const login='support-'+label,u=await provisionStudioUser(studio,vault,{login,name:'Synthetic '+label,role,password:'Synthetic-support-2026!'});
    const session=await auth.login({login,password:'Synthetic-support-2026!',code:totp((await vault.read(u.id)).totp,Date.now())});users[label]=(await auth.authenticate(session.value))!;
  }
  const source=(await api.lifeSpace(f.parent,f.child.id)).content.hash;
  let d=await editorial.create(users.editor,{sourceHash:source,version:'99.24.0-postgres'},randomUUID());d=await editorial.submit(users.editor,d.draft.id,`"${d.draft.version}"`,randomUUID());
  for(const [label,scope] of [['method','method'],['zh','language:zh-CN'],['en','language:en']])d=await editorial.review(users[label],d.draft.id,{scope,decision:'approve',note:'Synthetic PostgreSQL review fixture only; no professional review is represented.',sections:sectionIds,checks:{ageAppropriate:true,choiceAndRest:true,claims:true,language:true}},`"${d.draft.version}"`,randomUUID());
  d=await editorial.publish(users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:1},`"${d.draft.version}"`,randomUUID());
  const hash=d.draft.published_hash!;assert.equal((await api.parentGuide(f.parent,f.child.id)).content.hash,hash);
  await assert.rejects(db.query('UPDATE family_content_releases SET state=state'),errorCode('42501'));
  await assert.rejects(db.query('SELECT * FROM support_reviews'),errorCode('42501'));
  await assert.rejects(studio.query('SELECT * FROM life_goals'),errorCode('42501'));
  const input={intent:'suggest',templateId:'steps',support:'ask-first',contentHash:hash};
  const [goal,recall]=await Promise.allSettled([api.createLifeGoal(f.parent,f.child.id,input,randomUUID()),editorial.recall(users.publisher,d.draft.id,{confirmHash:hash,reason:'Synthetic concurrent recall test; no real family rollout.'},`"${d.draft.version}"`,randomUUID())]);
  assert.equal(recall.status,'fulfilled');
  if(goal.status==='fulfilled')await api.actLifeGoal(f.parent,f.child.id,goal.value.goal.id,{action:'stop'},'"1"',randomUUID());
  else assert.equal(goal.reason.code,'FAMILY_CONTENT_RECALLED');
  assert.equal((await api.lifeSpace(f.parent,f.child.id)).content.state,'recalled');
  await assert.rejects(api.createLifeGoal(f.parent,f.child.id,input,randomUUID()),errorCode('FAMILY_CONTENT_RECALLED'));
  noted('family-content-three-reviews-role-isolation-recall-concurrency');
});

test('HTTP boot uses separate runtime roles, survives restart, and preserves Web/native/studio separation', { timeout: 45000 }, async () => {
  const socket = createServer(); await new Promise<void>(done => socket.listen(0, '127.0.0.1', done));
  const port = (socket.address() as { port: number }).port; await new Promise<void>(done => socket.close(() => done()));
  const studioSocket = createServer(); await new Promise<void>(done => studioSocket.listen(0, '127.0.0.1', done));
  const studioPort = (studioSocket.address() as { port: number }).port; await new Promise<void>(done => studioSocket.close(() => done()));
  const studioBase = `http://127.0.0.1:${studioPort}`;
  const inputPath = join(config.root, 'studio-input.json'), outputPath = join(config.root, 'studio-enrollment.json');
  await writeFile(inputPath, JSON.stringify({ login: 'pg-editor', name: 'Synthetic editor', role: 'editor', password: 'Synthetic-editor-2026!' }), { mode: 0o600 });
  await exec(process.execPath, ['scripts/studio-identity.ts', 'provision', inputPath, outputPath], { env: { ...process.env, APP_MODE: 'local', DATABASE_URL: runtimeUrl.href, FOCUS_STUDIO_DATABASE_URL: studioUrl.href, FOCUS_DATA_DIR: dataDir }, timeout: 15000 });
  const editor = JSON.parse(await readFile(outputPath, 'utf8'));
  const base = `http://127.0.0.1:${port}`; let handle: ReturnType<typeof spawn> | undefined;
  async function boot() {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { env: { ...process.env, DATABASE_URL: runtimeUrl.href, DATABASE_MIGRATION_URL: '', FOCUS_STUDIO_DATABASE_URL: studioUrl.href, API_PORT: String(port), STUDIO_PORT: String(studioPort), FOCUS_DATA_DIR: dataDir, APP_MODE: 'local' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('HTTP_BOOT_TIMEOUT')), 12000);
      handle!.once('error', e => { clearTimeout(timer); fail(e); });
      handle!.once('exit', () => { clearTimeout(timer); fail(new Error('HTTP_EARLY_EXIT')); });
      handle!.stdout!.on('data', data => { if (String(data).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
  }
  async function stop() { if (handle && handle.exitCode === null) { const exited = new Promise(done => handle!.once('exit', done)); handle.kill('SIGTERM'); await exited; } }
  async function request(path: string, options: RequestInit = {}) { return fetch(base + '/api' + path, { ...options, signal: AbortSignal.timeout(8000) }); }
  try {
    await boot();
    const credentials = { name: 'Http-' + randomUUID().slice(0, 8), password: 'Synthetic-http-2026!' };
    const setup = await request('/auth/setup', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }) });
    assert.equal(setup.status, 200); const cookie = setup.headers.get('set-cookie')!.split(';')[0], { csrf } = await setup.json();
    const created = await request('/children', { method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: 'Http Child', ageBand: '9-11', locale: 'en', localConfirmation: true }) });
    assert.equal(created.status, 201);
    await stop(); await boot();
    assert.equal((await (await request('/me', { headers: { Cookie: cookie } })).json()).children.length, 1);
    const nativeLogin = await request('/auth/login', { method: 'POST', headers: { 'X-Focus-Client': 'native-local-v1', 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
    const { accessToken } = await nativeLogin.json(); assert.ok(accessToken); assert.equal(nativeLogin.headers.get('set-cookie'), null);
    assert.equal((await request('/me', { headers: { 'X-Focus-Client': 'native-local-v1', Authorization: `Bearer ${accessToken}` } })).status, 200);
    assert.equal((await request('/me', { headers: { Authorization: `Bearer ${accessToken}` } })).status, 403);
    assert.equal((await request('/me', { headers: { 'X-Focus-Client': 'native-local-v1', Cookie: cookie } })).status, 403);
    assert.equal((await fetch(studioBase + '/api/studio/me', { headers: { Cookie: cookie } })).status, 401);
    const studioLogin = await fetch(studioBase + '/api/studio/auth/login', { method: 'POST', headers: { Origin: studioBase, 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'pg-editor', password: 'Synthetic-editor-2026!', code: totp((await fileStudioVault(dataDir).read(editor.id)).totp, Date.now()) }) });
    assert.equal(studioLogin.status, 200);
    const studioCookie = studioLogin.headers.get('set-cookie')!.split(';')[0], studioCsrf = (await studioLogin.json()).csrf;
    const source = (await studio.query<{ hash: string }>("SELECT hash FROM content_releases WHERE pack_id='focus.search.6-8.en' LIMIT 1")).rows[0];
    const draft = await fetch(studioBase + '/api/studio/drafts', { method: 'POST', headers: { Origin: studioBase, Cookie: studioCookie, 'X-CSRF-Token': studioCsrf, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceHash: source.hash, version: '99.19.0-pg-qa' }) });
    assert.equal(draft.status, 201); assert.equal((await draft.json()).draft.state, 'draft');
    assert.equal((await request('/me', { headers: { Cookie: studioCookie } })).status, 401);
    noted('postgres-http-restart-web-native-studio-boundaries');
  } finally { await stop(); }
});


test('history keyset pages preserve microseconds and enforce fresh family and member access under RLS',async()=>{
  const f=await family(),other=await family();
  await admin.query(`INSERT INTO observations(id,child_id,task,context,prompts,child_choice,created_at)
    SELECT gen_random_uuid(),$1,'search','reading',0,true,'2026-09-01T10:00:00Z'::timestamptz+(i/3)*interval '1 microsecond' FROM generate_series(1,117) i`,[f.child.id]);
  const expected=(await admin.query<{id:string}>('SELECT id FROM observations WHERE child_id=$1 ORDER BY created_at DESC,id DESC',[f.child.id])).rows.map(r=>r.id);
  const one=await api.report(f.parent,f.child.id),two=await api.report(f.parent,f.child.id,{observationsCursor:one.history.observations.nextCursor}),three=await api.report(f.parent,f.child.id,{observationsCursor:two.history.observations.nextCursor});
  assert.deepEqual([...one.observations,...two.observations,...three.observations].map(r=>r.id),expected);assert.equal(three.history.observations.nextCursor,null);
  await assert.rejects(api.report(other.parent,f.child.id,{observationsCursor:one.history.observations.nextCursor}),rejected('NOT_FOUND'));
  const invite=await api.inviteMember(f.parent,{childIds:[f.child.id],acknowledged:true},randomUUID());
  const joined=await api.join({code:invite.code,loginName:'history-helper',displayName:'Synthetic helper',password:'Synthetic-history-helper!',acknowledgedLocalUse:true},'native');
  let helper=(await api.authenticate(joined.value,'native'))!;
  await assert.rejects(api.report(helper,f.child.id),rejected('MEMBER_PENDING'));
  await api.actMember(f.parent,helper.member_id,{action:'approve',acknowledged:true},'"1"');helper=(await api.authenticate(joined.value,'native'))!;
  assert.deepEqual((await api.report(helper,f.child.id,{observationsCursor:one.history.observations.nextCursor})).observations,two.observations);
  await api.actMember(f.parent,helper.member_id,{action:'revoke',acknowledged:true},'"2"');
  await assert.rejects(api.report(helper,f.child.id,{observationsCursor:two.history.observations.nextCursor}),rejected('UNAUTHENTICATED'));
  noted('history-microsecond-pagination-member-revocation-and-rls');
});

test('life history pages preserve precision, pin the current goal and enforce owner-only parent access under RLS',async()=>{
  const f=await family(),other=await family(),contentHash=(await api.lifeSpace(f.parent,f.child.id)).content.hash!;
  const first=(await api.createLifeGoal(f.parent,f.child.id,{intent:'suggest',templateId:'steps',support:'ask-first',contentHash},randomUUID())).goal;
  await api.actLifeGoal(f.parent,f.child.id,first.id,{action:'stop'},'"1"',randomUUID());
  await admin.query("UPDATE life_goals SET created_at='2026-09-01T00:00:00Z' WHERE id=$1",[first.id]);
  await admin.query(`INSERT INTO life_goals(id,child_id,version,state,template,support,created_by,reflection_sharing,created_at,updated_at,request_key,request_hash,content_hash)
    SELECT gen_random_uuid(),child_id,version,state,template,support,created_by,reflection_sharing,created_at+(i/3)*interval '1 microsecond',updated_at,gen_random_uuid()::text,'synthetic',content_hash
    FROM life_goals CROSS JOIN generate_series(1,32) i WHERE id=$1`,[first.id]);
  const current=(await api.createLifeGoal(f.parent,f.child.id,{intent:'suggest',templateId:'find',support:'space',contentHash},randomUUID())).goal;
  await admin.query("UPDATE life_goals SET created_at='2000-01-01T00:00:00Z' WHERE id=$1",[current.id]);
  const expected=(await admin.query<{id:string}>("SELECT id FROM life_goals WHERE child_id=$1 AND state='stopped' ORDER BY created_at DESC,id DESC",[f.child.id])).rows.map(g=>g.id);
  const one=await api.lifeHistory(f.parent,f.child.id),cursor=one.history.nextCursor!,two=await api.lifeHistory(f.parent,f.child.id,{cursor});
  assert.equal(one.goals[0].id,current.id);assert.equal(two.goals[0].id,current.id);assert.deepEqual([...one.goals.slice(1),...two.goals.slice(1)].map(g=>g.id),expected);assert.equal(two.history.nextCursor,null);
  await assert.rejects(api.lifeHistory(other.parent,f.child.id,{cursor}),rejected('NOT_FOUND'));
  const invite=await api.inviteMember(f.parent,{childIds:[f.child.id],acknowledged:true},randomUUID());
  const joined=await api.join({code:invite.code,loginName:'life-history-helper',displayName:'Synthetic helper',password:'Synthetic-life-history-helper!',acknowledgedLocalUse:true},'native');
  let helper=(await api.authenticate(joined.value,'native'))!;await assert.rejects(api.lifeHistory(helper,f.child.id,{cursor}),rejected('MEMBER_PENDING'));
  await api.actMember(f.parent,helper.member_id,{action:'approve',acknowledged:true},'"1"');helper=(await api.authenticate(joined.value,'native'))!;
  await assert.rejects(api.lifeHistory(helper,f.child.id,{cursor}),rejected('OWNER_REQUIRED'));
  const entered=await api.enterChild(f.parent,f.child.id),cp=(await api.authenticate(entered.auth.value))!;assert.deepEqual((await api.lifeHistory(cp,f.child.id,{cursor})).goals,two.goals);
  const parent=await login(f);await api.withdraw(parent,f.child.id);assert.equal((await api.lifeHistory(parent,f.child.id,{cursor})).collectionActive,false);await assert.rejects(api.lifeHistory(cp,f.child.id,{cursor}),rejected('UNAUTHENTICATED'));
  noted('life-history-microsecond-pages-current-goal-owner-child-and-rls');
});
