import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('Web and native guide routes protect family access, retain read-only access after withdrawal, and never write on reading', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-guide-http-')), base = 'http://127.0.0.1:4234'; let handle;
  async function boot() {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { cwd: resolve(import.meta.dirname, '../..'), env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', API_PORT: '4234', STUDIO_PORT: '0', FOCUS_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = ''; handle.stderr.on('data', chunk => diagnostics += String(chunk));
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Guide HTTP boot timeout')), 15000);
      handle.once('error', e => { clearTimeout(timer); reject(e); });
      handle.once('exit', () => { clearTimeout(timer); reject(new Error('Guide HTTP service exited: ' + diagnostics)); });
      handle.stdout.on('data', data => { if (String(data).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
  }
  async function stop() { if (!handle || handle.exitCode !== null) return; const stopped = new Promise(done => handle.once('exit', done)); handle.kill('SIGTERM'); await stopped; }
  async function call(path, auth = {}, method = 'GET', data) {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(auth.native ? { 'X-Focus-Client': 'native-local-v1', ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) } : { Origin: base, ...(auth.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}) }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000) });
    return { response, body: await response.json() };
  }
  const credentials = { name: 'Synthetic guide family', password: 'Synthetic-guide-http-2026!' };
  const webAuth = result => ({ cookie: result.response.headers.get('set-cookie').split(';')[0], csrf: result.body.csrf });
  try {
    await boot();
    const setup = await call('/auth/setup', {}, 'POST', { ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
    const parent = webAuth(setup), child = (await call('/children', parent, 'POST', { alias: 'Synthetic Teen', ageBand: '15-17', locale: 'en', localConfirmation: true })).body;
    const path = `/children/${child.id}/parent-guide`;
    assert.equal((await call(path)).response.status, 401);
    const initial = await call(path, parent); assert.equal(initial.response.status, 200); assert.equal(initial.response.headers.get('cache-control'), 'no-store');
    assert.equal(initial.body.version, 'parent-guide-2-preview'); assert.equal(initial.body.review, 'unreviewed'); assert.equal(initial.body.lessons.length, 9);
    const before = (await call(`/children/${child.id}/export`, parent)).body; delete before.exportedAt;
    await call(path, parent); await call(path, parent);
    const after = (await call(`/children/${child.id}/export`, parent)).body; delete after.exportedAt; assert.deepEqual(after, before);
    assert.equal((await call(path, parent, 'POST', {})).response.status, 404);
    const other = webAuth(await call('/auth/setup', {}, 'POST', { ...credentials, name: 'Other guide family', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }));
    assert.equal((await call(path, other)).response.status, 404);
    const childWeb = webAuth(await call(`/children/${child.id}/enter`, parent, 'POST', {}));
    assert.equal((await call(path, parent)).response.status, 401);
    assert.equal((await call(path, childWeb)).body.code, 'PARENT_REQUIRED');
    const login = await call('/auth/login', { native: true }, 'POST', credentials), native = { native: true, token: login.body.accessToken };
    const nativeRead = await call(path, native); assert.deepEqual(nativeRead.body, initial.body); assert.equal(nativeRead.response.headers.get('set-cookie'), null);
    const childNative = await call(`/children/${child.id}/enter`, native, 'POST', {});
    assert.equal((await call(path, { native: true, token: childNative.body.accessToken })).body.code, 'PARENT_REQUIRED');
    const loggedIn = webAuth(await call('/auth/login', {}, 'POST', credentials));
    await call(`/children/${child.id}/withdraw`, loggedIn, 'POST', {});
    assert.equal((await call(path, loggedIn)).body.collectionActive, false);
    await stop(); await boot();
    assert.equal((await call(path, loggedIn)).body.collectionActive, false);
    assert.equal((await call(`/children/${child.id}`, loggedIn, 'DELETE')).response.status, 200);
    assert.equal((await call(path, loggedIn)).response.status, 404);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
