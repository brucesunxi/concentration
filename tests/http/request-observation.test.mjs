import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

test('real family HTTP results correlate to private-data-free events across Web and native failures', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-observation-http-'));
  const socket = createServer(); await new Promise((done, fail) => { socket.once('error', fail); socket.listen(0, '127.0.0.1', done); });
  const port = socket.address().port; await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`, privateValue = 'private-synthetic-' + randomUUID();
  const events = []; let output = '', pending = '', handle;
  const credentials = { name: 'Synthetic observed family', password: 'Synthetic observation password!' };
  try {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', FOCUS_DATA_DIR: directory, API_PORT: String(port), STUDIO_PORT: '0', FOCUS_HTTP_LOGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Observation service timeout')), 15000);
      handle.once('error', error => { clearTimeout(timer); reject(error); });
      handle.once('exit', () => { clearTimeout(timer); reject(new Error('Observation service exited')); });
      handle.stdout.on('data', chunk => {
        const text = String(chunk); output += text; pending += text;
        let end; while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          try { const value = JSON.parse(line); if (value.event === 'FAMILY_HTTP_REQUEST') events.push(value); } catch { /* Startup banner. */ }
        }
        if (output.includes('本地开发模式')) { clearTimeout(timer); done(); }
      });
      handle.stderr.resume();
    });
    async function call(path, method = 'GET', body, headers = {}) {
      const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Origin: base, 'X-Request-ID': privateValue, 'User-Agent': privateValue, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) });
      const value = await response.json(), requestId = response.headers.get('x-request-id');
      assert.match(requestId, /^[a-f0-9-]{36}$/); assert.notEqual(requestId, privateValue);
      const until = Date.now() + 2000; while (!events.some(event => event.requestId === requestId) && Date.now() < until) await new Promise(done => setTimeout(done, 10));
      const matches = events.filter(event => event.requestId === requestId); assert.equal(matches.length, 1);
      assert.equal(matches[0].status, response.status); assert.equal(matches[0].version, '0.46.0');
      if (response.status >= 400) assert.equal(value.requestId, requestId);
      return { response, value, event: matches[0] };
    }
    const ready = await call('/ready?private=' + privateValue); assert.equal(ready.event.outcome, 'ok'); assert.equal(ready.event.route, '/api/ready');
    const registration = await call('/auth/setup', 'POST', { ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
    const cookie = registration.response.headers.get('set-cookie').split(';')[0], csrf = registration.value.csrf;
    const child = await call('/children', 'POST', { alias: privateValue.slice(0, 24), ageBand: '6-8', locale: 'en', localConfirmation: true }, { Cookie: cookie, 'X-CSRF-Token': csrf });
    assert.equal(child.event.status, 201); assert.equal(child.event.route, '/api/children');
    const invalid = await call(`/children/${child.value.id}/sessions?private=${privateValue}`, 'POST', { task: privateValue, deviceId: randomUUID(), private: privateValue }, { Cookie: cookie, 'X-CSRF-Token': csrf });
    assert.equal(invalid.value.code, 'INVALID_REQUEST'); assert.equal(invalid.event.code, 'INVALID_REQUEST'); assert.equal(invalid.event.route, '/api/children/:childId/sessions');
    const denied = await call(`/children/${child.value.id}/practice-limits`, 'GET', undefined, { Origin: '', 'X-Focus-Client': 'native-local-v1', Authorization: 'Bearer ' + 'a'.repeat(64) });
    assert.equal(denied.event.transport, 'native'); assert.equal(denied.event.code, 'UNAUTHENTICATED');
    const unknown = await call('/' + privateValue); assert.equal(unknown.event.route, 'unknown-api');
    const logs = JSON.stringify(events);
    for (const value of [privateValue, privateValue.slice(0, 24), credentials.name, credentials.password, cookie, csrf, child.value.id, 'a'.repeat(64)]) assert.equal(logs.includes(value), false);
    for (const event of events) { assert.equal(event.schemaVersion, 1); assert.ok(event.durationMs >= 0); assert.equal(event.runtimeWaitMs, null); }
  } finally {
    if (handle && handle.exitCode === null) { const ended = new Promise(done => handle.once('exit', done)); handle.kill('SIGTERM'); await ended; }
    await rm(directory, { recursive: true, force: true });
  }
});
