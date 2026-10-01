import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('teen strategy route is child-scoped, age-gated and rejects malformed query strings', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-teen-history-http-'));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const handle = spawn(process.execPath, ['apps/api/main.ts'], { cwd: resolve(import.meta.dirname, '../..'),
    env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', API_PORT: String(port), STUDIO_PORT: '0', FOCUS_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  handle.stderr.on('data', chunk => stderr += String(chunk));
  const stop = async () => { if (handle.exitCode !== null) return; const done = new Promise(resolve => handle.once('exit', resolve)); handle.kill('SIGTERM'); await done; };
  const call = async (path, token, method = 'GET', data) => {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Focus-Client': 'native-local-v1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  try {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Teen history service boot timed out: ' + stderr)), 15000);
      handle.once('error', error => { clearTimeout(timer); reject(error); });
      handle.once('exit', () => { clearTimeout(timer); reject(new Error('Teen history service exited: ' + stderr)); });
      handle.stdout.on('data', chunk => { if (String(chunk).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
    const credentials = { name: 'Synthetic teen trail', password: 'Synthetic-teen-trail-2026!' };
    const setup = await call('/auth/setup', null, 'POST', { ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
    assert.equal(setup.status, 200);
    const parent = setup.body.accessToken;
    const teen = (await call('/children', parent, 'POST', { alias: 'Teen', ageBand: '15-17', locale: 'en', localConfirmation: true })).body;
    const young = (await call('/children', parent, 'POST', { alias: 'Young', ageBand: '6-8', locale: 'en', localConfirmation: true })).body;
    const path = `/children/${teen.id}/strategy-history`;
    assert.equal((await call(path, parent)).body.code, 'CHILD_REQUIRED');
    const child = await call(`/children/${teen.id}/enter`, parent, 'POST', {});
    assert.equal(child.status, 200);
    const token = child.body.accessToken;
    const empty = await call(path, token);
    assert.equal(empty.status, 200); assert.equal(empty.cache, 'no-store');
    assert.deepEqual(empty.body, { version: 'teen-strategy-history-1', childId: teen.id, pageSize: 20, items: [], nextCursor: null });
    assert.equal((await call(`/children/${young.id}/strategy-history`, token)).body.code, 'NOT_FOUND');
    for (const suffix of ['?cursor=%%%', '?cursor=a&cursor=b', '?limit=999']) assert.equal((await call(path + suffix, token)).status, 400);
    const relogin = await call('/auth/login', null, 'POST', credentials);
    const younger = await call(`/children/${young.id}/enter`, relogin.body.accessToken, 'POST', {});
    assert.equal((await call(`/children/${young.id}/strategy-history`, younger.body.accessToken)).body.code, 'AGE_GROUP_UNAVAILABLE');
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
