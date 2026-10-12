import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { grantRuntimeRoles, verifyRuntimeRole } from '../../apps/api/family-isolation.ts';
import { memberContext } from '../../apps/api/family-members.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { completeEvents } from '../platform/fixtures.ts';

const port = process.env.FOCUS_QA_POSTGRES_PORT, data = process.env.FOCUS_QA_POSTGRES_DATA;
if (process.env.GITHUB_ACTIONS !== 'true' || !port || !/^\d+$/.test(port) || !data ||
  !process.env.RUNNER_TEMP || !data.startsWith(process.env.RUNNER_TEMP + '/focus-postgres-') || !data.endsWith('/data'))
  throw new Error('FRESH_LOCAL_POSTGRES_FIXTURE_REQUIRED');
// Construct and verify every target before connecting. External URL variables
// are never read, and all roles belong solely to this disposable cluster.
function open(role: 'owner' | 'family' | 'studio') {
  const url = new URL(`postgresql://focus_qa_${role}@127.0.0.1:${port}/focus_qa`);
  url.searchParams.set('application_name', `focus-qa-${role}`);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/focus_qa');
  return openDatabase('memory://', url.toString());
}
let owner: Database, db: Database, studio: Database, api: FocusService;
const passed: string[] = [], evidence: Record<string, unknown> = {};
before(async () => {
  owner = await open('owner');
  const identity = (await owner.query<{ path: string; database: string; version: string }>(
    "SELECT current_setting('data_directory') AS path,current_database() AS database,version() AS version")).rows[0];
  assert.equal(identity.path, data); assert.equal(identity.database, 'focus_qa');
  assert.match(identity.version, /^PostgreSQL 16\./); evidence.serverVersion = identity.version;
  await Promise.all([migrate(owner), migrate(owner), migrate(owner)]);
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  process.env.FOCUS_SESSION_SIGNING_JWK = JSON.stringify(await crypto.subtle.exportKey('jwk', signing.privateKey));
  await createLocalContent(owner); await createSessionAuthority(owner);
  await owner.query('CREATE ROLE focus_qa_family LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  await owner.query('CREATE ROLE focus_qa_studio LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  await grantRuntimeRoles(owner, 'focus_qa_family', 'focus_qa_studio');
  db = await open('family'); studio = await open('studio');
  const content = await createLocalContent(db, { readOnly: true });
  const authority = await createSessionAuthority(db, { readOnly: true });
  delete process.env.FOCUS_SESSION_SIGNING_JWK;
  api = service(db, Date.now, content, authority);
});
after(async () => {
  try {
    if (owner) {
      await owner.query('DELETE FROM families');
      const counts = (await owner.query('SELECT (SELECT count(*)::int FROM families) AS families,(SELECT count(*)::int FROM children) AS children,(SELECT count(*)::int FROM sessions) AS sessions')).rows[0];
      evidence.cleanup = counts;
      assert.deepEqual(counts, { families: 0, children: 0, sessions: 0 });
    }
  } finally {
    delete process.env.FOCUS_SESSION_SIGNING_JWK;
    await Promise.all([db?.close(), studio?.close(), owner?.close()]);
    if (process.env.FOCUS_QA_POSTGRES_REPORT)
      await writeFile(process.env.FOCUS_QA_POSTGRES_REPORT, JSON.stringify({ ...evidence, passed }, null, 2) + '\n');
  }
});
async function family() {
  const credentials = { name: 'PG-' + randomUUID(), password: 'Synthetic-PG-passphrase-2026!' };
  const auth = await api.setup({ ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
  const p = (await api.authenticate(auth.value))!;
  const c = await api.addChild(p, { alias: 'Synthetic explorer', ageBand: '6-8', locale: 'en', localConfirmation: true });
  return { credentials, auth, p, c };
}
const denied = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

test('concurrent migrations and current schema validate both restricted runtime roles', async () => {
  await migrate(owner);
  assert.equal((await owner.query<{ version: number }>('SELECT max(version) AS version FROM schema_migrations')).rows[0].version, 32);
  await verifyRuntimeRole(db, 'family'); await verifyRuntimeRole(studio, 'studio');
  await assert.rejects(db.query('CREATE TABLE forbidden_qa(id int)'), /permission denied/);
  await assert.rejects(db.query('SELECT * FROM studio_users'), /permission denied/);
  await assert.rejects(studio.query('SELECT * FROM children'), /permission denied/);
  passed.push('schema32-and-runtime-role-boundaries');
});
test('64 interleaved transactions do not leak family context across pooled connections', async () => {
  const a = await family(), b = await family();
  await Promise.all(Array.from({ length: 64 }, async (_, index) => {
    const f = index % 2 ? a : b;
    await db.context!(memberContext(f.p), () => db.transaction(async tx => {
      await tx.query('SELECT pg_sleep(0.005)');
      const rows = (await tx.query<{ id: string }>('SELECT id FROM children')).rows;
      assert.deepEqual(rows.map(r => r.id), [f.c.id]);
    }));
  }));
  assert.equal((await db.query('SELECT id FROM children')).rows.length, 0);
  await assert.rejects(api.report(a.p, b.c.id), denied('NOT_FOUND'));
  evidence.interleavedTransactions = 64; passed.push('pooled-family-isolation');
});
test('the ninth transaction queues until one of eight occupied pool connections is released', async () => {
  let release!: () => void, filled!: () => void, acquired = 0, ninth = false;
  const gate = new Promise<void>(r => release = r), ready = new Promise<void>(r => filled = r);
  const holders = Array.from({ length: 8 }, () => db.transaction(async () => { if (++acquired === 8) filled(); await gate; }));
  try {
    await ready;
    const queued = db.transaction(async tx => { ninth = true; await tx.query('SELECT 1'); });
    await delay(100); assert.equal(ninth, false);
    release(); await Promise.all([...holders, queued]); assert.equal(ninth, true);
  } finally { release(); await Promise.allSettled(holders); }
  passed.push('pool-queue-and-recovery');
});
test('a SQL failure rolls back changes and the next checkout has no family context', async () => {
  const f = await family();
  await assert.rejects(db.context!(memberContext(f.p), () => db.transaction(async tx => {
    await tx.query("UPDATE children SET alias='must roll back' WHERE id=$1", [f.c.id]);
    await tx.query('SELECT * FROM missing_qa_table');
  })), /does not exist/);
  assert.equal((await owner.query<{ alias: string }>('SELECT alias FROM children WHERE id=$1', [f.c.id])).rows[0].alias, f.c.alias);
  assert.equal((await db.query('SELECT id FROM children')).rows.length, 0);
  passed.push('sql-error-rollback');
});
test('terminating a checked-out backend between queries rolls back and replaces the broken connection', async () => {
  const f = await family();
  await assert.rejects(db.context!(memberContext(f.p), () => db.transaction(async tx => {
    await tx.query("UPDATE children SET alias='must not commit' WHERE id=$1", [f.c.id]);
    const pid = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const killed = await owner.query<{ stopped: boolean }>("SELECT pg_terminate_backend(pid) AS stopped FROM pg_stat_activity WHERE pid=$1 AND datname='focus_qa' AND usename='focus_qa_family' AND application_name='focus-qa-family'", [pid]);
    assert.equal(killed.rows[0]?.stopped, true); await delay(100);
  })));
  assert.equal((await owner.query<{ alias: string }>('SELECT alias FROM children WHERE id=$1', [f.c.id])).rows[0].alias, f.c.alias);
  await db.query('SELECT 1'); assert.equal((await db.query('SELECT id FROM children')).rows.length, 0);
  passed.push('checked-out-backend-loss-and-replacement');
});
test('concurrent observation, event and finalize retries commit one result and one course step', async () => {
  const f = await family(), key = randomUUID();
  const observations = await Promise.all(Array.from({ length: 12 }, () => api.observe(f.p, f.c.id,
    { task: 'search', context: 'packing', prompts: 2, childChoice: true }, key)));
  assert.equal(new Set(observations.map(x => x.id)).size, 1);
  const { session, auth } = await api.start(f.p, f.c.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
  const child = (await api.authenticate(auth.value))!, events = completeEvents(session.plan);
  await Promise.all(Array.from({ length: 6 }, () => api.append(child, session.id, { events })));
  const results = await Promise.all(Array.from({ length: 8 }, () => api.finalize(child, session.id, { lastSeq: events.length })));
  for (const result of results) assert.deepEqual(result, results[0]);
  const parent = (await api.authenticate((await api.login(f.credentials)).value))!;
  const report = await api.report(parent, f.c.id);
  assert.equal(report.observationCount, 1); assert.equal(report.sessions.length, 1);
  assert.equal(report.child.completedSessions, 1); assert.equal(report.child.course.unit, 1);
  passed.push('concurrent-exactly-once-business-writes');
});
test('family deletion cascades and old credentials cannot upload unfinished practice', async () => {
  const f = await family();
  const { session, auth } = await api.start(f.p, f.c.id, { task: 'search', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
  const child = (await api.authenticate(auth.value))!;
  const parent = (await api.authenticate((await api.login(f.credentials)).value))!;
  await api.deleteFamily(parent, { currentPassword: f.credentials.password, familyName: f.credentials.name, acknowledged: true });
  assert.equal(await api.authenticate(auth.value), null);
  await assert.rejects(api.append(child, session.id, { events: completeEvents(session.plan) }), denied('UNAUTHENTICATED'));
  assert.equal((await owner.query('SELECT id FROM children WHERE family_id=$1', [f.p.family_id])).rows.length, 0);
  passed.push('deletion-and-old-upload-rejection');
});
