import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

test('family deletion requires creator, password, exact name and CSRF, then survives restart', { timeout: 40000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-delete-family-http-'));
  const socket = createServer(); await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port; await new Promise(done => socket.close(done));
  const origin = `http://127.0.0.1:${port}`;
  let handle;
  async function boot() {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', FOCUS_DATA_DIR: directory, API_PORT: String(port), STUDIO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Family deletion API startup timed out')), 15000);
      handle.once('error', reject); handle.once('exit', () => reject(new Error('Family deletion API exited')));
      handle.stdout.on('data', chunk => { if (String(chunk).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
  }
  async function stop() {
    if (!handle || handle.exitCode !== null) return;
    const ended = new Promise(done => handle.once('exit', done)); handle.kill('SIGTERM'); await ended;
  }
  async function call(path, auth = {}, method = 'GET', body, extra = {}) {
    const response = await fetch(origin + '/api' + path, {
      method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
    return { response, body: await response.json() };
  }
  const web = value => ({ cookie: value.response.headers.get('set-cookie').split(';')[0], csrf: value.body.csrf });
  const owner = { name: 'Synthetic deletion family', password: 'Synthetic-deletion-passphrase!' };
  try {
    await boot();
    const ready = await call('/ready');
    assert.equal(ready.response.status, 200); assert.equal(ready.body.status, 'ok');
    const original = web(await call('/auth/setup', {}, 'POST', { ...owner, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }));
    const other = web(await call('/auth/setup', {}, 'POST', { name: 'Unrelated synthetic family', password: 'Unrelated-synthetic-password!', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }));
    const profile = (await call('/children', original, 'POST', { alias: 'Synthetic child', ageBand: '9-11', locale: 'en', localConfirmation: true })).body;
    const child = web(await call(`/children/${profile.id}/enter`, original, 'POST', {}));
    const fresh = web(await call('/auth/login', {}, 'POST', owner));
    const input = { currentPassword: owner.password, familyName: owner.name, acknowledged: true };
    assert.equal((await call('/family', child, 'DELETE', input)).body.code, 'PARENT_REQUIRED');
    assert.equal((await call('/family', fresh, 'DELETE', input, { 'X-CSRF-Token': 'wrong' })).body.code, 'CSRF_REJECTED');
    assert.equal((await call('/family', fresh, 'DELETE', input, { Origin: 'https://untrusted.invalid' })).body.code, 'ORIGIN_REJECTED');
    assert.equal((await call('/family', fresh, 'DELETE', { ...input, familyName: 'wrong' })).body.code, 'FAMILY_NAME_MISMATCH');
    assert.equal((await call('/family', fresh, 'DELETE', { ...input, currentPassword: 'incorrect' })).body.code, 'PASSWORD_REJECTED');
    assert.equal((await call('/family', fresh, 'DELETE', { ...input, acknowledged: false })).body.code, 'INVALID_REQUEST');
    const deleted = await call('/family', fresh, 'DELETE', input);
    assert.equal(deleted.response.status, 200); assert.equal(deleted.body.signInRequired, true);
    assert.match(deleted.response.headers.get('set-cookie'), /Max-Age=0/);
    for (const auth of [fresh, child]) assert.equal((await call('/me', auth)).response.status, 401);
    assert.equal((await call('/me', other)).response.status, 200);
    await stop(); await boot();
    assert.equal((await call('/auth/login', {}, 'POST', owner)).body.code, 'LOGIN_FAILED');
    assert.equal((await call('/me', other)).response.status, 200);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
