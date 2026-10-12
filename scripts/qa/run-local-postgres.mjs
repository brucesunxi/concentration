import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import net from 'node:net';

// Only a fresh, single-job Linux runner may host this destructive fixture.
// No connection URL is accepted from the environment or command line.
if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP)
  throw new Error('POSTGRES_QA_REQUIRES_DISPOSABLE_CI_RUNNER');
const execute = promisify(execFile), bin = '/usr/lib/postgresql/16/bin';
const temporary = await realpath(process.env.RUNNER_TEMP);
const directory = await mkdtemp(join(temporary, 'focus-postgres-'));
const data = join(directory, 'data'), socket = join(directory, 'socket');
const report = resolve('dist/postgres-qa/report.json');
await mkdir(socket, { mode: 0o700 });
await mkdir(resolve('dist/postgres-qa'), { recursive: true });
const port = await new Promise((accept, reject) => {
  const server = net.createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const selected = server.address().port;
    server.close(error => error ? reject(error) : accept(selected));
  });
});
if (!/^[a-zA-Z0-9/_-]+$/.test(directory)) throw new Error('UNEXPECTED_RUNNER_TEMP_PATH');
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/DATABASE|NEON|^PG|FOCUS_SESSION_SIGNING/.test(key)) delete environment[key];
Object.assign(environment, { FOCUS_QA_POSTGRES_PORT: String(port), FOCUS_QA_POSTGRES_DATA: data,
  FOCUS_QA_POSTGRES_REPORT: report, APP_MODE: 'local' });
let started = false, code = 1;
try {
  await execute(join(bin, 'initdb'), ['-D', data, '-U', 'focus_qa_owner', '--auth=trust', '--encoding=UTF8', '--no-locale'], { env: environment });
  started = true;
  await execute(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${socket} -c max_connections=24`, '-w', 'start'], { env: environment });
  await execute(join(bin, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'focus_qa_owner', 'focus_qa'], { env: environment });
  code = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/postgres/runtime.test.ts'], { env: environment, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', status => accept(status ?? 1));
  });
} finally {
  let stopped = !started;
  if (started) {
    try {
      await execute(join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: environment });
      await execute(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { env: environment });
      stopped = true;
    } catch (error) {
      if (error.code === 3 || error.code === 4) stopped = true;
      else throw error;
    }
  }
  if (stopped) await rm(directory, { recursive: true, force: true });
  let evidence = {};
  try { evidence = JSON.parse(await readFile(report, 'utf8')); } catch {}
  await writeFile(report, JSON.stringify({ ...evidence, exitCode: code, serverStopped: stopped, temporaryClusterRemoved: stopped,
    boundary: 'Fresh loopback-only PostgreSQL 16 CI cluster; no Neon, containers, real families or external database credentials.' }, null, 2) + '\n');
}
process.exitCode = code;
