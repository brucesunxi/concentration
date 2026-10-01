import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

test('account password and all-session signout enforce HTTP boundaries and persist across restart', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-account-http-'));
  const socket = createServer(); await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port; await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`; let handle;
  async function boot() {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', FOCUS_DATA_DIR: directory, API_PORT: String(port), STUDIO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Account service timeout')), 15000);
      handle.once('error', error => { clearTimeout(timer); reject(error); });
      handle.once('exit', () => { clearTimeout(timer); reject(new Error('Account service exited')); });
      handle.stdout.on('data', data => { if (String(data).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
  }
  async function stop() { if (handle && handle.exitCode === null) { const ended = new Promise(done => handle.once('exit', done)); handle.kill('SIGTERM'); await ended; } }
  async function call(path, auth = {}, method = 'GET', body, extra = {}) {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(auth.native ? { 'X-Focus-Client': 'native-local-v1', ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) } : { Origin: base, ...(auth.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}) }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) });
    return { response, body: await response.json() };
  }
  const web = result => ({ cookie: result.response.headers.get('set-cookie').split(';')[0], csrf: result.body.csrf });
  const credentials = { name: 'Synthetic account family', password: 'Synthetic old password!' }, next = 'Synthetic new password!';
  try {
    await boot();
    const p = web(await call('/auth/setup', {}, 'POST', { ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }));
    const c = (await call('/children', p, 'POST', { alias: 'Synthetic child', ageBand: '6-8', locale: 'en', localConfirmation: true })).body;
    const billing = await call('/family/billing', p);
    assert.equal(billing.response.status, 200); assert.equal(billing.body.state, 'preview');
    assert.equal(billing.body.familyId, (await call('/me', p)).body.family.id);
    assert.equal('productId' in billing.body, false);
    const other = web(await call('/auth/setup', {}, 'POST', { ...credentials, name: 'Other synthetic account', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }));
    const native = { native: true, token: (await call('/auth/login', { native: true }, 'POST', credentials)).body.accessToken };
    assert.equal((await call('/account/security', p)).body.active.parent.native, 1);
    const child = web(await call(`/children/${c.id}/enter`, p, 'POST', {}));
    assert.equal((await call('/family/billing', child)).body.code, 'PARENT_REQUIRED');
    assert.equal((await call('/account/security', child)).body.code, 'PARENT_REQUIRED');
    const change = { currentPassword: credentials.password, newPassword: next, acknowledged: true };
    assert.equal((await call('/auth/change-password', child, 'POST', change)).body.code, 'PARENT_REQUIRED');
    const fresh = web(await call('/auth/login', {}, 'POST', credentials));
    assert.equal((await call('/auth/change-password', fresh, 'POST', change, { 'X-CSRF-Token': 'wrong' })).body.code, 'CSRF_REJECTED');
    assert.equal((await call('/auth/change-password', fresh, 'POST', change, { Origin: 'https://untrusted.invalid' })).body.code, 'ORIGIN_REJECTED');
    assert.equal((await call('/auth/change-password', fresh, 'POST', { ...change, currentPassword: 'incorrect' })).body.code, 'PASSWORD_REJECTED');
    const changed = await call('/auth/change-password', fresh, 'POST', change); assert.equal(changed.response.status, 200); assert.match(changed.response.headers.get('set-cookie'), /Max-Age=0/);
    for (const old of [fresh, child, native]) assert.equal((await call('/me', old)).response.status, 401);
    assert.equal((await call('/me', other)).response.status, 200);
    assert.equal((await call('/auth/login', {}, 'POST', credentials)).body.code, 'LOGIN_FAILED');
    await stop(); await boot();
    const current = web(await call('/auth/login', {}, 'POST', { ...credentials, password: next }));
    assert.equal((await call('/me', current)).body.children[0].id, c.id);
    assert.ok((await call('/account/security', current)).body.passwordChangedAt);
    const nativeCurrent = { native: true, token: (await call('/auth/login', { native: true }, 'POST', { ...credentials, password: next })).body.accessToken };
    const out = await call('/auth/logout-all', nativeCurrent, 'POST', { currentPassword: next, acknowledged: true });
    assert.equal(out.response.status, 200); assert.equal(out.response.headers.get('set-cookie'), null); assert.equal(out.body.signInRequired, true);
    assert.equal((await call('/me', current)).response.status, 401); assert.equal((await call('/me', nativeCurrent)).response.status, 401);
    assert.equal((await call('/me', other)).response.status, 200);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
