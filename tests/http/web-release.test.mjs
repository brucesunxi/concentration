import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { publishWebRelease, readWebReleaseState } from '../../packages/web-release/index.ts';
import { webFixture } from '../platform/web-release.fixture.ts';

test('a live family service switches complete Web releases while old lazy files, records and login survive publication and restart', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-web-http-')), store = join(directory, 'releases');
  const a = await webFixture(join(directory, 'a'), 'HTTP A'), b = await webFixture(join(directory, 'b'), 'HTTP B');
  const first = await publishWebRelease(a.directory, store, { version: 'A', expected: null });
  const base = 'http://127.0.0.1:4197'; let handle;
  async function boot() {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { cwd: resolve(import.meta.dirname, '../..'), env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', API_PORT: '4197', STUDIO_PORT: '0', FOCUS_DATA_DIR: join(directory, 'data'), FOCUS_WEB_RELEASE_DIR: store }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Web release HTTP boot timeout')), 15000);
      handle.once('error', error => { clearTimeout(timer); reject(error); });
      handle.once('exit', () => { clearTimeout(timer); reject(new Error('Web release HTTP service exited')); });
      handle.stdout.on('data', data => { if (String(data).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
  }
  async function stop() {
    if (!handle || handle.exitCode !== null) return;
    const stopped = new Promise(done => handle.once('exit', done)); handle.kill('SIGTERM'); await stopped;
  }
  async function call(path, method = 'GET', data, auth = {}, extra = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...(auth.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...extra }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10000) });
    return response;
  }
  try {
    await boot();
    const initial = await call('/'); assert.equal(await initial.text(), a.html); assert.equal(initial.headers.get('x-focus-web-release'), first.id); assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.equal(await (await call('/' + a.mainPath)).text(), a.files.get(a.mainPath));
    const setup = await call('/api/auth/setup', 'POST', { name: 'Synthetic update family', password: 'Synthetic-update-2026!', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
    assert.equal(setup.status, 200); const auth = { cookie: setup.headers.get('set-cookie').split(';')[0], csrf: (await setup.json()).csrf };
    const child = await (await call('/api/children', 'POST', { alias: 'Synthetic Robin', ageBand: '9-11', locale: 'en', localConfirmation: true }, auth)).json();
    const path = `/api/children/${child.id}/life-goals`;
    const goal = await (await call(path, 'POST', { contentHash:(await (await call(path,'GET',undefined,auth)).json()).content.hash,intent: 'suggest', templateId: 'steps', support: 'ask-first' }, auth, { 'Idempotency-Key': randomUUID() })).json();
    assert.equal(goal.goal.state, 'proposed');
    const publishing = publishWebRelease(b.directory, store, { version: 'B', expected: first.id });
    const reads = await Promise.all(Array.from({ length: 20 }, async () => { const response = await call('/'); assert.equal(response.status, 200); return response.text(); }));
    const second = await publishing;
    assert.ok(reads.every(html => html === a.html || html === b.html));
    assert.equal(await (await call('/')).text(), b.html);
    const lazy = await call('/' + a.lazyPath); assert.equal(await lazy.text(), a.lazyBody); assert.equal(lazy.headers.get('x-focus-web-release'), first.id); assert.match(lazy.headers.get('cache-control'), /immutable/); assert.equal(lazy.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await (await call('/' + b.lazyPath)).text(), b.lazyBody);
    const head = await call('/' + a.lazyPath, 'HEAD'); assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.match(head.headers.get('content-type'), /javascript/);
    const worker = await call('/focus-sw.js'); assert.equal(worker.headers.get('cache-control'), 'no-store'); assert.equal(worker.headers.get('x-focus-web-release'), second.id);
    for (const blocked of ['/.vite/manifest.json', '/current.json', `/releases/${first.id}/manifest.json`, '/.env', '/assets/%2e%2e/private.json']) assert.equal((await call(blocked)).status, 404, blocked);
    assert.equal((await call('/', 'POST', {})).status, 405);
    const c = await webFixture(join(directory, 'c'), 'Broken next release'); await writeFile(join(c.directory, 'focus-sw.js'), 'broken');
    await assert.rejects(publishWebRelease(c.directory, store, { version: 'C', expected: second.id }), /SHELL_MISMATCH/);
    assert.equal((await readWebReleaseState(store)).current, second.id);
    await stop(); await boot();
    assert.equal(await (await call('/')).text(), b.html);
    assert.equal(await (await call('/' + a.lazyPath)).text(), a.lazyBody);
    const me = await call('/api/me', 'GET', undefined, auth); assert.equal(me.status, 200); assert.equal((await me.json()).family.name, 'Synthetic update family');
    const history = await (await call(path, 'GET', undefined, auth)).json(); assert.equal(history.goals[0].id, goal.goal.id); assert.equal(history.total, 1);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
