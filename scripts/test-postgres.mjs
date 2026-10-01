import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile), docker = process.env.FOCUS_DOCKER || '/usr/local/bin/docker';
const root = await mkdtemp(join(tmpdir(), 'focus-postgres-qa-'));
const name = 'focus-pg-qa-' + randomUUID(), password = randomBytes(32).toString('hex');
let created = false, cleaned = false, running, stage = 'inspect-image', failure;
const run = (...args) => exec(docker, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { running?.kill(signal); });
try {
  const image = JSON.parse((await run('image', 'inspect', process.env.FOCUS_PG_TEST_IMAGE || 'postgres:16-alpine')).stdout)[0];
  stage = 'create-container';
  await writeFile(join(root, 'container.env'), `POSTGRES_USER=focus_migration\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=focus_qa\n`, { mode: 0o600 });
  await run('run', '--detach', '--pull=never', '--name', name, '--label', 'app.focus.test=postgres-isolation',
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw', '--shm-size', '256m', '--memory', '768m', '--cpus', '2',
    '--env-file', join(root, 'container.env'), image.Id);
  created = true;
  stage = 'read-container-port';
  const port = (await run('port', name, '5432/tcp')).stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error('TEST_DATABASE_LOOPBACK_REQUIRED');
  stage = 'wait-for-database';
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { await run('exec', name, 'pg_isready', '-U', 'focus_migration', '-d', 'focus_qa'); ready = true; break; }
    catch { await delay(250); }
  }
  if (!ready) throw new Error('TEST_DATABASE_NOT_READY');
  stage = 'prepare-test-manifest';
  const manifest = { root, adminUrl: `postgresql://focus_migration:${password}@127.0.0.1:${port}/focus_qa`,
    runtimePassword: randomBytes(32).toString('hex'), studioPassword: randomBytes(32).toString('hex'), imageId: image.Id, repoDigests: image.RepoDigests };
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
  stage = 'run-tests';
  running = spawn(process.execPath, ['--test', 'tests/postgres/isolation.test.ts'], { env: { ...process.env, FOCUS_PG_TEST_MANIFEST: path }, stdio: 'inherit' });
  const timeout = setTimeout(() => running.kill('SIGTERM'), 240000);
  const code = await new Promise((resolve, reject) => { running.once('error', reject); running.once('exit', code => resolve(code ?? 1)); });
  clearTimeout(timeout); process.exitCode = code;
} catch (error) {
  // Do not log child-process arguments, environment, or connection strings.
  failure = { stage, code: error?.code || 'TEST_HARNESS_FAILURE', signal: error?.signal ?? null, commandTerminated: error?.killed === true };
  console.error('PostgreSQL verification failed:', failure.stage, failure.code); process.exitCode = 1;
} finally {
  if (created) await run('rm', '--force', name).then(() => { cleaned = true; }).catch(() => { console.error('TEST_CONTAINER_CLEANUP_REQUIRED', name); process.exitCode = 1; });
  await rm(root, { recursive: true, force: true });
  if (process.env.FOCUS_PG_EVIDENCE) {
    let proof = {}; try { proof = JSON.parse(await readFile(process.env.FOCUS_PG_EVIDENCE, 'utf8')); } catch { /* A boot failure may have no assertion report. */ }
    await writeFile(process.env.FOCUS_PG_EVIDENCE, JSON.stringify({ ...proof, processExitCode: process.exitCode ?? 0, status: process.exitCode ? 'failed' : 'passed', testContainerCreated: created, testContainerRemoved: cleaned, ...(failure ? {failure} : {}) }, null, 2) + '\n');
  }
}
