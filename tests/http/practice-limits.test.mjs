import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

test('Web and native practice plans require parent scope, current versions and confirmation, and persist across restart', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-limits-http-'));
  const socket = createServer(); await new Promise((done, fail) => { socket.once('error', fail); socket.listen(0, '127.0.0.1', done); });
  const port = socket.address().port; await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`; let handle;
  async function boot() {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', FOCUS_DATA_DIR: directory, API_PORT: String(port), STUDIO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Practice service timeout')), 15000);
      handle.once('error', error => { clearTimeout(timer); reject(error); });
      handle.once('exit', () => { clearTimeout(timer); reject(new Error('Practice service exited')); });
      handle.stdout.on('data', data => { if (String(data).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
  }
  async function stop() { if (handle && handle.exitCode === null) { const ended = new Promise(done => handle.once('exit', done)); handle.kill('SIGTERM'); await ended; } }
  async function call(path, auth = {}, method = 'GET', body, extra = {}) {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(auth.native ? { 'X-Focus-Client': 'native-local-v1', ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) } : { Origin: base, ...(auth.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}) }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) });
    return { response, body: await response.json() };
  }
  const web = result => ({ cookie: result.response.headers.get('set-cookie').split(';')[0], csrf: result.body.csrf });
  const credentials = { name: 'Synthetic limits family', password: 'Synthetic limits password!' };
  try {
    await boot();
    let p = web(await call('/auth/setup', {}, 'POST', { ...credentials, timezone: 'America/New_York', locale: 'en', acknowledgedLocalUse: true }));
    const c = (await call('/children', p, 'POST', { alias: 'Synthetic Child', ageBand: '6-8', locale: 'en', localConfirmation: true })).body;
    const sibling = (await call('/children', p, 'POST', { alias: 'Synthetic Teen', ageBand: '15-17', locale: 'en', localConfirmation: true })).body;
    const path = `/children/${c.id}/practice-limits`, first = await call(path, p);
    assert.equal(first.body.currentMinutes, 8); assert.match(first.response.headers.get('cache-control'), /no-store/);
    const input = { minutes: 3, effectiveDay: first.body.nextDay, acknowledged: true };
    assert.equal((await call(path, p, 'PATCH', input)).response.status, 428);
    assert.equal((await call(path, p, 'PATCH', input, { 'If-Match': '"1"', 'X-CSRF-Token': 'wrong' })).body.code, 'CSRF_REJECTED');
    assert.equal((await call(path, p, 'PATCH', input, { 'If-Match': '"1"', Origin: 'https://untrusted.invalid' })).body.code, 'ORIGIN_REJECTED');
    assert.equal((await call(path, p, 'PATCH', { ...input, acknowledged: false }, { 'If-Match': '"1"' })).body.code, 'INVALID_REQUEST');
    const child = web(await call(`/children/${c.id}/enter`, p, 'POST', {}));
    assert.equal((await call(path, child)).body.canEdit, false);
    assert.equal((await call(`/children/${sibling.id}/practice-limits`, child)).response.status, 404);
    assert.equal((await call(path, child, 'PATCH', input, { 'If-Match': '"1"' })).body.code, 'PARENT_REQUIRED');
    p = web(await call('/auth/login', {}, 'POST', credentials));
    const native = { native: true, token: (await call('/auth/login', { native: true }, 'POST', credentials)).body.accessToken };
    const race = await Promise.all([call(path, p, 'PATCH', input, { 'If-Match': '"1"' }), call(path, native, 'PATCH', { ...input, minutes: 2 }, { 'If-Match': '"1"' })]);
    assert.deepEqual(race.map(x => x.response.status).sort(), [200, 409]);
    const version = (await call(path, native)).body.settingsVersion;
    const paused = await call(path, native, 'PATCH', { ...input, minutes: 0 }, { 'If-Match': `"${version}"` });
    assert.equal(paused.body.next.minutes, 0); assert.equal(paused.body.currentMinutes, 8); assert.equal(paused.response.headers.get('set-cookie'), null);
    const other = web(await call('/auth/setup', {}, 'POST', { ...credentials, name: 'Other synthetic limits', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }));
    assert.equal((await call(path, other)).response.status, 404);
    await stop(); await boot();
    const restored = (await call(path, p)).body; assert.deepEqual(restored.next, paused.body.next); assert.equal(restored.settingsVersion, paused.body.settingsVersion);
    const exported = (await call(`/children/${c.id}/export`, p)).body; assert.deepEqual(exported.practiceLimits.next, restored.next);
    await call(`/children/${c.id}/withdraw`, p, 'POST', {});
    assert.equal((await call(path, p)).body.status, 'collection-stopped');
    assert.equal((await call(path, p, 'PATCH', input, { 'If-Match': `"${restored.settingsVersion}"` })).body.code, 'CONSENT_REVOKED');
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
