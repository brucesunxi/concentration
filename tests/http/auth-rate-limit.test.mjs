import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const base = 'http://127.0.0.1:4291/api';

async function boot(dataDir) {
  const child = spawn(process.execPath, ['apps/api/main.ts'], {
    cwd: root, env: { ...process.env, DATABASE_URL: '', APP_MODE: 'local', API_PORT: '4291', FOCUS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Auth test API startup timed out')), 15000);
    child.once('error', fail);
    child.once('exit', () => fail(new Error('Auth test API exited during startup')));
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('本地开发模式')) { clearTimeout(timer); done(); }
    });
  });
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await ended;
}

async function login() {
  const response = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:4180', 'Content-Type': 'application/json', 'X-Forwarded-For': String(Math.random()) },
    body: JSON.stringify({ name: 'Missing synthetic family', password: 'Synthetic-wrong-passphrase' }),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}

test('HTTP auth limit persists across API restarts and ignores spoofed forwarding headers locally', { timeout: 35000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'focus-auth-limit-http-'));
  let child;
  try {
    child = await boot(dataDir);
    for (let index = 0; index < 11; index++) assert.equal((await login()).status, 401);
    await stop(child);
    child = await boot(dataDir);
    assert.equal((await login()).status, 401);
    const blocked = await login();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'RATE_LIMITED');
  } finally {
    await stop(child);
    await rm(dataDir, { recursive: true, force: true });
  }
});
