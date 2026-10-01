import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { completeEvents } from '../platform/fixtures.ts';
import { verifyRelease, verifyAsset, sha256 } from '../../packages/content/index.ts';
import { practiceWindowPolicy } from '../../packages/session-runtime/practice-window.ts';
import { verifyGrant } from '../../packages/session-runtime/authorization.ts';
import { nativeVerifier } from '../../packages/content/native-verifier.ts';

const root = resolve(import.meta.dirname, '../..');
const base = 'http://127.0.0.1:4192/api';
const origin = 'http://127.0.0.1:4180';
let processHandle;
async function boot(dataDir) {
  processHandle = spawn(process.execPath, ['apps/api/main.ts'], { cwd: root, env: { ...process.env, DATABASE_URL: '', APP_MODE: 'local', API_PORT: '4192', FOCUS_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local API did not start in time')), 15000);
    processHandle.once('error', error => { clearTimeout(timeout); reject(error); });
    processHandle.once('exit', () => { clearTimeout(timeout); reject(new Error('Local API exited during startup')); });
    processHandle.stdout.on('data', chunk => { if (String(chunk).includes('本地开发模式')) { clearTimeout(timeout); resolve(); } });
  });
}
async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return;
  const exited = new Promise(resolve => processHandle.once('exit', resolve));
  processHandle.kill('SIGTERM');
  await exited;
}
async function call(path, { method = 'GET', data, cookie, csrf, key, match, token, native = false, customOrigin = native ? '' : origin } = {}) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(customOrigin ? { Origin: customOrigin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(match ? { 'If-Match': match } : {}), ...(native ? { 'X-Focus-Client': 'native-local-v1' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000),
  });
  return { response, body: await response.json() };
}

test('family life goals survive restart and enforce choice, version, transport, withdrawal and deletion over HTTP', { timeout: 40000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'focus-life-http-'));
  try {
    await boot(dataDir);
    const login = { name: 'Synthetic everyday family', password: 'synthetic-everyday-password' };
    const setup = await call('/auth/setup', { method: 'POST', data: { ...login, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true } });
    const parent = { cookie: setup.response.headers.get('set-cookie').split(';')[0], csrf: setup.body.csrf };
    const child = (await call('/children', { ...parent, method: 'POST', data: { alias: 'Synthetic teen', ageBand: '12-14', locale: 'en', localConfirmation: true } })).body;
    const path = `/children/${child.id}/life-goals`, entry = `/children/${child.id}/enter`;
    const key = randomUUID(), proposal = { contentHash:(await call(path,parent)).body.content.hash,intent: 'suggest', templateId: 'return', support: 'ask-first' };
    assert.equal((await call(path, { ...parent, method: 'POST', key, data: proposal, csrf: 'wrong' })).body.code, 'CSRF_REJECTED');
    const created = await call(path, { ...parent, method: 'POST', data: proposal, key });
    assert.equal(created.response.status, 201); assert.equal(created.body.goal.state, 'proposed');
    assert.equal(created.body.goal.template.ageBand, '12-14'); assert.equal(created.body.goal.template.review, 'unreviewed');
    const goalPath = `${path}/${created.body.goal.id}`;
    assert.equal((await call(goalPath, { ...parent, method: 'PATCH', data: { action: 'stop' }, key: randomUUID() })).response.status, 428);
    assert.equal((await call(goalPath, { ...parent, method: 'PATCH', data: { action: 'accept', support: 'space' }, match: '"1"', key: randomUUID() })).body.code, 'CHILD_REQUIRED');
    assert.equal((await call(entry, { ...parent, method: 'POST', data: {} , csrf: 'wrong' })).body.code, 'CSRF_REJECTED');
    assert.equal((await call(entry, { ...parent, method: 'POST', data: { task: 'search' } })).response.status, 400);
    assert.equal((await call('/me', parent)).response.status, 200);
    const entered = await call(entry, { ...parent, method: 'POST', data: {} });
    assert.equal(entered.response.status, 200); assert.equal(entered.body.child.id, child.id); assert.equal(entered.body.accessToken, undefined);
    const scope = { cookie: entered.response.headers.get('set-cookie').split(';')[0], csrf: entered.body.csrf };
    assert.equal((await call('/me', parent)).response.status, 401);
    assert.equal((await call('/sessions/active', scope)).body, null);
    assert.equal((await call(path, scope)).body.role, 'child');
    const acceptKey = randomUUID(), accept = { action: 'accept', support: 'space' };
    assert.equal((await call(goalPath, { ...scope, method: 'PATCH', data: accept, match: 'W/"1"', key: acceptKey })).response.status, 400);
    const accepted = await call(goalPath, { ...scope, method: 'PATCH', data: accept, match: '"1"', key: acceptKey });
    assert.equal(accepted.body.goal.version, 2); assert.equal(accepted.body.goal.support, 'space');
    assert.equal((await call(goalPath, { ...scope, method: 'PATCH', data: { action: 'decline' }, match: '"1"', key: randomUUID() })).body.code, 'GOAL_CONFLICT');
    const reflect = { action: 'reflect', sharing: 'family', reflection: { outcome: 'partly', helpful: 'unsure', next: 'smaller' } };
    assert.equal((await call(goalPath, { ...scope, method: 'PATCH', data: reflect, match: '"2"', key: randomUUID() })).body.goal.state, 'reflected');
    const replay = await call(goalPath, { ...scope, method: 'PATCH', data: accept, match: '"1"', key: acceptKey });
    assert.equal(replay.body.replayed, true); assert.equal(replay.body.goal.state, 'reflected');
    await stop(); await boot(dataDir);
    const history = await call(path, scope);
    assert.equal(history.response.headers.get('cache-control'), 'no-store');
    assert.equal(history.body.total, 1); assert.deepEqual(history.body.goals[0].reflection, reflect.reflection);
    assert.equal((await call('/me', scope)).body.children[0].completedSessions, 0);

    const nativeLogin = await call('/auth/login', { method: 'POST', native: true, data: login });
    assert.equal(nativeLogin.response.headers.get('set-cookie'), null);
    const nativeParent = { native: true, token: nativeLogin.body.accessToken };
    const next = await call(path, { ...nativeParent, method: 'POST', data: proposal, key: randomUUID() });
    assert.equal(next.response.status, 201);
    const nativeEntry = await call(entry, { ...nativeParent, method: 'POST', data: {} });
    assert.equal(nativeEntry.response.status, 200); assert.equal(nativeEntry.response.headers.get('set-cookie'), null); assert.equal(nativeEntry.body.csrf, undefined);
    const nativeChild = { native: true, token: nativeEntry.body.accessToken };
    assert.equal((await call('/me', nativeParent)).response.status, 401);
    assert.equal((await call(path, { token: nativeChild.token })).body.code, 'TRANSPORT_REJECTED');
    assert.equal((await call(entry, { ...nativeChild, method: 'POST', data: {} })).body.code, 'PARENT_REQUIRED');
    const nativeAccept = await call(`${path}/${next.body.goal.id}`, { ...nativeChild, method: 'PATCH', data: accept, match: '"1"', key: randomUUID() });
    assert.equal(nativeAccept.body.goal.state, 'active');

    const again = await call('/auth/login', { method: 'POST', data: login });
    const unlocked = { cookie: again.response.headers.get('set-cookie').split(';')[0], csrf: again.body.csrf };
    assert.equal((await call(`/children/${child.id}/withdraw`, { ...unlocked, method: 'POST', data: {} })).response.status, 200);
    assert.equal((await call(path, nativeChild)).response.status, 401); assert.equal((await call(path, scope)).response.status, 401);
    const exported = await call(`/children/${child.id}/export`, unlocked);
    assert.equal(exported.body.life.goals.length, 2); assert.equal(exported.body.life.actions.length, 6);
    assert.equal(exported.body.life.goals.find(g => g.id === next.body.goal.id).closedReason, 'withdrawn');
    for (const field of ['request_key', 'request_hash', 'accessToken', 'csrf']) assert.equal(JSON.stringify(exported.body).includes(field), false);
    assert.equal((await call(path, { ...unlocked, method: 'POST', data: proposal, key })).body.code, 'CONSENT_REVOKED');
    assert.equal((await call(`/children/${child.id}`, { ...unlocked, method: 'DELETE' })).response.status, 200);
    assert.equal((await call(path, unlocked)).response.status, 404);
  } finally { await stop(); await rm(dataDir, { recursive: true, force: true }); }
});

test('real HTTP service verifies a signed v2 practice, enforces access and persists its result and trust across restart', { timeout: 40000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'focus-http-'));
  try {
    await boot(dataDir);
    const setup = { name: 'HTTP synthetic family', password: 'synthetic-http-test-2026', timezone: 'Asia/Shanghai', locale: 'en', acknowledgedLocalUse: true };
    assert.equal((await call('/auth/setup', { method: 'POST', data: setup, customOrigin: undefined })).response.status, 200);
    // The first identity is intentionally synthetic and is used only by this test.
    const logged = await call('/auth/login', { method: 'POST', data: { name: setup.name, password: setup.password } });
    assert.equal(logged.response.status, 200);
    const cookieHeader = logged.response.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Strict/);
    assert.equal(logged.response.headers.get('cache-control'), 'no-store');
    let cookie = cookieHeader.split(';')[0], csrf = logged.body.csrf;
    assert.equal((await call('/me')).response.status, 401);
    const input = { alias: 'Synthetic child', ageBand: '9-11', locale: 'en', localConfirmation: true };
    assert.equal((await call('/children', { method: 'POST', data: input, cookie, csrf, customOrigin: '' })).body.code, 'ORIGIN_REJECTED');
    assert.equal((await call('/children', { method: 'POST', data: input, cookie, csrf, customOrigin: 'https://unrelated.example' })).body.code, 'ORIGIN_REJECTED');
    assert.equal((await call('/children', { method: 'POST', data: input, cookie, csrf: 'incorrect' })).body.code, 'CSRF_REJECTED');
    assert.equal((await call('/children', { method: 'POST', data: { ...input, score: 100 }, cookie, csrf })).response.status, 400);
    const child = await call('/children', { method: 'POST', data: input, cookie, csrf });
    assert.equal(child.response.status, 201);
    const environment = { platform: 'web', deviceClass: 'desktop', input: 'pointer', modality: 'visual' };
    const deviceId = randomUUID();
    const started = await call(`/children/${child.body.id}/sessions`, { method: 'POST', data: { task: 'memory', deviceId, environment }, cookie, csrf, key: randomUUID() });
    assert.equal(started.response.status, 201);
    assert.equal(started.body.continuation_grant.body.version, 2);
    assert.deepEqual(started.body.continuation_grant.body.windowPolicy, practiceWindowPolicy(started.body.plan.ageBand));
    assert.ok(Date.parse(started.body.continuation_grant.body.recordUntil) - Date.parse(started.body.continuation_grant.body.issuedAt) <= practiceWindowPolicy(started.body.plan.ageBand).maxElapsedMs);
    assert.equal(started.body.plan.version, '2.0.0');
    assert.deepEqual(started.body.plan.environment, environment);
    assert.equal((await call('/me', { cookie })).response.status, 401);
    cookie = started.response.headers.get('set-cookie').split(';')[0]; csrf = started.body.csrf;
    const authorities = await call('/session-authorities', { cookie });
    assert.equal(authorities.response.status, 200); assert.equal(authorities.response.headers.get('cache-control'), 'no-store');
    assert.ok(authorities.body.keys.every(key => !('d' in key.jwk)));
    await verifyGrant(started.body.continuation_grant, authorities.body.keys, { sessionId: started.body.id, childId: child.body.id, deviceId, plan: started.body.plan, budgetMs: started.body.budget_ms, transport: 'web' });
    assert.equal((await call(`/sessions/${started.body.id}/status`, { cookie })).body.canContinue, true);
    assert.equal((await call(`/children/${child.body.id}/report`, { cookie })).response.status, 403);
    const trust = await call('/content/trust', { cookie });
    const release = await call(`/content/releases/${started.body.plan.content.sha256}`, { cookie });
    assert.equal(release.response.status, 200);
    assert.equal(release.body.body.packHash, started.body.plan.content.sha256);
    const pack = await verifyRelease(release.body, trust.body.keys, { mode: 'local', market: 'LOCAL' });
    assert.equal(pack.review, 'unreviewed');
    for (const asset of pack.assets) {
      const media = await fetch(new URL(asset.path, base), { signal: AbortSignal.timeout(10000) });
      assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), asset.mime);
      assert.match(media.headers.get('cache-control'), /immutable/);
      await verifyAsset(asset, new Uint8Array(await media.arrayBuffer()));
    }
    const events = completeEvents(started.body.plan);
    for (let offset = 0; offset < events.length; offset += 100) {
      const receipt = await call(`/sessions/${started.body.id}/events`, { method: 'POST', cookie, csrf, data: { events: events.slice(offset, offset + 100) } });
      assert.equal(receipt.response.status, 200);
      assert.equal(receipt.body.highestContiguousSeq, Math.min(offset + 100, events.length));
    }
    const finalized = await call(`/sessions/${started.body.id}/finalize`, { method: 'POST', cookie, csrf, data: { lastSeq: events.length } });
    assert.equal(finalized.response.status, 200); assert.equal(finalized.body.completed, true);
    assert.equal(finalized.body.engineVersion, '2.0.0');
    assert.equal(finalized.body.metrics.accuracy, 1);
    await stop();
    await boot(dataDir);
    const restored = await call('/me', { cookie });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.body.children.length, 1);
    assert.equal(restored.body.children[0].id, child.body.id);
    assert.equal(restored.body.children[0].completedSessions, 1);
    assert.equal(JSON.stringify(restored.body).includes('password_hash'), false);
    const restoredTrust = await call('/content/trust', { cookie });
    assert.deepEqual(restoredTrust.body, trust.body);
    const restoredAuthorities = await call('/session-authorities', { cookie }); assert.deepEqual(restoredAuthorities.body, authorities.body);
    await verifyGrant(started.body.continuation_grant, restoredAuthorities.body.keys, { sessionId: started.body.id, childId: child.body.id, deviceId, plan: started.body.plan, budgetMs: started.body.budget_ms, transport: 'web' });
    assert.equal((await call(`/sessions/${started.body.id}/status`, { cookie })).body.canContinue, false);
    const restoredRelease = await call(`/content/releases/${started.body.plan.content.sha256}`, { cookie });
    assert.deepEqual(restoredRelease.body, release.body);
    await verifyRelease(restoredRelease.body, restoredTrust.body.keys, { mode: 'local', market: 'LOCAL' });
    assert.equal(pack.version, '0.7.3-preview');
    assert.ok(pack.audio?.assetId, 'the English practice has fixed narration');
    for (const asset of pack.assets) {
      const restoredMedia = await fetch(new URL(asset.path, base));
      assert.equal(restoredMedia.status, 200);
      await verifyAsset(asset, new Uint8Array(await restoredMedia.arrayBuffer()));
    }
    // The upgraded catalogue must also serve the exact immutable URLs referenced
    // by pre-upgrade plans. A restart may not strand their original images.
    for (const file of ['src/assets/characters-sheet.png', 'src/assets/objects-sheet.png', 'packages/visuals/archive/objects-sheet-640-preview.png', 'packages/visuals/archive/objects-sheet-512-preview.png']) {
      const bytes = new Uint8Array(await readFile(resolve(root, file))), hash = await sha256(bytes);
      const historicalMedia = await fetch(new URL(`/content-assets/${hash}.png`, base));
      assert.equal(historicalMedia.status, 200);
      assert.equal(await sha256(new Uint8Array(await historicalMedia.arrayBuffer())), hash);
    }
    const relogged = await call('/auth/login', { method: 'POST', data: { name: setup.name, password: setup.password } });
    assert.equal(relogged.response.status, 200);
    cookie = relogged.response.headers.get('set-cookie').split(';')[0]; csrf = relogged.body.csrf;
    const report = await call(`/children/${child.body.id}/report`, { cookie });
    assert.equal(report.body.sessions.length, 1); assert.equal(report.body.sessions[0].result.completed, true);
    const removed = await call(`/children/${child.body.id}`, { method: 'DELETE', cookie, csrf });
    assert.equal(removed.response.status, 200);
    assert.equal((await call('/me', { cookie })).body.children.length, 0);
    const out = await call('/auth/logout', { method: 'POST', data: {}, cookie, csrf });
    assert.equal(out.response.status, 200);
    assert.match(out.response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call('/me', { cookie })).response.status, 401);
  } finally { await stop(); await rm(dataDir, { recursive: true, force: true }); }
});

test('native tokens are separate from browser cookies, rotate into child scope and complete native observations', { timeout: 40000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'focus-native-http-'));
  try {
    await boot(dataDir);
    const setup = { name: 'Native synthetic family', password: 'synthetic-native-test-2026', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true };
    const web = await call('/auth/setup', { method: 'POST', data: setup }); assert.equal(web.response.status, 200);
    const cookie = web.response.headers.get('set-cookie').split(';')[0], webToken = cookie.slice('focus_session='.length);
    const credentials = { name: setup.name, password: setup.password };
    assert.equal((await call('/auth/login', { method: 'POST', data: credentials, native: true, customOrigin: origin })).body.code, 'NATIVE_REQUEST_REJECTED');
    assert.equal((await call('/auth/login', { method: 'POST', data: credentials, native: true, cookie })).body.code, 'NATIVE_REQUEST_REJECTED');
    assert.equal((await call('/me', { native: true, token: webToken })).response.status, 401);
    const native = await call('/auth/login', { method: 'POST', data: credentials, native: true });
    assert.equal(native.response.status, 200); assert.equal(native.response.headers.get('set-cookie'), null);
    const token = native.body.accessToken; assert.ok(/^[a-f0-9]{64}$/.test(token));
    assert.equal((await call('/me', { token })).body.code, 'TRANSPORT_REJECTED');
    assert.equal((await call('/me', { cookie: `focus_session=${token}` })).response.status, 401);
    const child = await call('/children', { method: 'POST', native: true, token, data: { alias: 'Native explorer', ageBand: '12-14', locale: 'en', localConfirmation: true } });
    assert.equal(child.response.status, 201);
    const nativeAsWeb = await call(`/children/${child.body.id}/sessions`, { method: 'POST', native: true, token, key: randomUUID(), data: { task: 'stop', deviceId: randomUUID(), environment: { platform: 'web', deviceClass: 'desktop', input: 'pointer', modality: 'visual' } } });
    assert.equal(nativeAsWeb.body.code, 'ENVIRONMENT_TRANSPORT_MISMATCH');
    const webAsNative = await call(`/children/${child.body.id}/sessions`, { method: 'POST', cookie, csrf: web.body.csrf, key: randomUUID(), data: { task: 'stop', deviceId: randomUUID(), environment: { platform: 'ios', deviceClass: 'phone', input: 'touch', modality: 'visual' } } });
    assert.equal(webAsNative.body.code, 'ENVIRONMENT_TRANSPORT_MISMATCH');
    const deviceId = randomUUID();
    const started = await call(`/children/${child.body.id}/sessions`, { method: 'POST', native: true, token, key: randomUUID(), data: { task: 'stop', deviceId, environment: { platform: 'ios', deviceClass: 'phone', input: 'touch', modality: 'visual' } } });
    assert.equal(started.response.status, 201);
    assert.equal(started.body.continuation_grant.body.version, 2);
    assert.deepEqual(started.body.continuation_grant.body.windowPolicy, practiceWindowPolicy(started.body.plan.ageBand));
    assert.ok(Date.parse(started.body.continuation_grant.body.recordUntil) - Date.parse(started.body.continuation_grant.body.issuedAt) <= practiceWindowPolicy(started.body.plan.ageBand).maxElapsedMs); assert.equal(started.response.headers.get('set-cookie'), null);
    const childToken = started.body.accessToken; assert.ok(/^[a-f0-9]{64}$/.test(childToken));
    const authorities = await call('/session-authorities', { native: true, token: childToken });
    await verifyGrant(started.body.continuation_grant, authorities.body.keys, { sessionId: started.body.id, childId: child.body.id, deviceId, plan: started.body.plan, budgetMs: started.body.budget_ms, transport: 'native' }, nativeVerifier);
    assert.equal((await call(`/sessions/${started.body.id}/status`, { native: true, token: childToken })).body.canContinue, true);
    assert.equal((await call('/me', { native: true, token })).response.status, 401);
    assert.equal((await call(`/children/${child.body.id}/report`, { native: true, token: childToken })).response.status, 403);
    const events = completeEvents(started.body.plan);
    for (let offset = 0; offset < events.length; offset += 100) assert.equal((await call(`/sessions/${started.body.id}/events`, { method: 'POST', native: true, token: childToken, data: { events: events.slice(offset, offset + 100) } })).response.status, 200);
    const result = await call(`/sessions/${started.body.id}/finalize`, { method: 'POST', native: true, token: childToken, data: { lastSeq: events.length } });
    assert.equal(result.response.status, 200); assert.equal(result.body.completed, true); assert.equal(result.body.environment.platform, 'ios');
    const weeklyPath = `/children/${child.body.id}/weekly`;
    assert.equal((await call(weeklyPath, { native: true, token: childToken })).response.status, 403);
    const weekly = await call(weeklyPath, { cookie });
    assert.equal(weekly.response.status, 200); assert.equal(weekly.response.headers.get('cache-control'), 'no-store');
    assert.equal(weekly.body.coverage.completed, 1); assert.equal(weekly.body.groups[0].environment.platform, 'ios');
    assert.equal((await call(weeklyPath + '?weekStart=2026-02-30', { cookie })).response.status, 400);
    assert.equal((await call(weeklyPath + `?weekStart=${weekly.body.range.start}&weekStart=${weekly.body.range.start}`, { cookie })).response.status, 400);
    await stop(); await boot(dataDir);
    assert.equal((await call(weeklyPath + `?weekStart=${weekly.body.range.start}`, { cookie })).body.coverage.completed, 1);
    assert.equal((await call('/me', { native: true, token: childToken })).body.children[0].completedSessions, 1);
    const logout = await call('/auth/logout', { method: 'POST', native: true, token: childToken, data: {} });
    assert.equal(logout.response.status, 200); assert.equal(logout.response.headers.get('set-cookie'), null);
    assert.equal((await call('/me', { native: true, token: childToken })).response.status, 401);
    assert.equal((await call('/me', { cookie })).response.status, 200);
  } finally { await stop(); await rm(dataDir, { recursive: true, force: true }); }
});

test('native parent data tools deduplicate observations, export records, withdraw collection and delete a profile', { timeout: 40000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'focus-native-privacy-'));
  try {
    await boot(dataDir);
    const credentials = { name: 'Privacy synthetic family', password: 'synthetic-parent-test-2026' };
    const setup = await call('/auth/setup', { method: 'POST', native: true, data: { ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true } });
    assert.equal(setup.response.status, 200);
    let token = setup.body.accessToken;
    const child = await call('/children', { method: 'POST', native: true, token, data: { alias: 'Privacy explorer', ageBand: '15-17', locale: 'en', localConfirmation: true } });
    const path = `/children/${child.body.id}`, key = randomUUID();
    const observation = { task: 'memory', context: 'project', prompts: 2, childChoice: true };
    assert.equal((await call(path + '/observations', { method: 'POST', native: true, token, data: observation })).body.code, 'INVALID_IDEMPOTENCY_KEY');
    const first = await call(path + '/observations', { method: 'POST', native: true, token, key, data: observation });
    assert.equal(first.response.status, 201);
    assert.equal((await call(path + '/observations', { method: 'POST', native: true, token, key, data: observation })).body.id, first.body.id);
    assert.equal((await call(path + '/observations', { method: 'POST', native: true, token, key, data: { ...observation, prompts: 3 } })).body.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await call(path + '/report', { native: true, token })).body.observationCount, 1);
    const weekly = await call(path + '/weekly', { native: true, token });
    assert.equal(weekly.response.status, 200); assert.equal(weekly.body.life[0].current.count, 1);
    const exported = await call(path + '/export', { native: true, token });
    assert.equal(exported.response.status, 200); assert.equal(exported.body.observations.length, 1); assert.ok(!JSON.stringify(exported.body).includes(key));
    const started = await call(path + '/sessions', { method: 'POST', native: true, token, key: randomUUID(), data: { task: 'memory', deviceId: randomUUID(), environment: { platform: 'android', deviceClass: 'phone', input: 'touch', modality: 'visual' } } });
    assert.equal(started.response.status, 201);
    assert.equal(started.body.continuation_grant.body.version, 2);
    assert.deepEqual(started.body.continuation_grant.body.windowPolicy, practiceWindowPolicy(started.body.plan.ageBand));
    assert.ok(Date.parse(started.body.continuation_grant.body.recordUntil) - Date.parse(started.body.continuation_grant.body.issuedAt) <= practiceWindowPolicy(started.body.plan.ageBand).maxElapsedMs); const childToken = started.body.accessToken;
    for (const suffix of ['/export', '/report', '/weekly']) assert.equal((await call(path + suffix, { native: true, token: childToken })).response.status, 403);
    assert.equal((await call(path + '/withdraw', { method: 'POST', native: true, token: childToken, data: {} })).response.status, 403);
    assert.equal((await call(path, { method: 'DELETE', native: true, token: childToken })).response.status, 403);
    token = (await call('/auth/login', { method: 'POST', native: true, data: credentials })).body.accessToken;
    assert.equal((await call(path + '/withdraw', { method: 'POST', native: true, token, data: {} })).body.withdrawn, true);
    assert.equal((await call('/me', { native: true, token: childToken })).response.status, 401);
    assert.equal((await call(path + '/observations', { method: 'POST', native: true, token, key, data: observation })).body.code, 'CONSENT_REVOKED');
    assert.equal((await call(path + '/export', { native: true, token })).body.observations.length, 1);
    assert.equal((await call(path + '/weekly', { native: true, token })).body.life[0].current.count, 1);
    assert.equal((await call(path, { method: 'DELETE', native: true, token })).body.deleted, true);
    assert.equal((await call(path, { method: 'DELETE', native: true, token })).body.code, 'NOT_FOUND');
    assert.equal((await call('/me', { native: true, token })).body.children.length, 0);
    assert.equal((await call(path + '/export', { native: true, token })).body.code, 'NOT_FOUND');
    assert.equal((await call(path + '/weekly', { native: true, token })).body.code, 'NOT_FOUND');
    await stop(); await boot(dataDir);
    assert.equal((await call('/me', { native: true, token })).body.children.length, 0);
  } finally { await stop(); await rm(dataDir, { recursive: true, force: true }); }
});

test('parent-confirmed device handover preserves old uploads as separate history across transports and server restart', {timeout:40000},async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'focus-handover-http-'));
 try{
  await boot(dataDir);
  const login={name:'Synthetic handover family',password:'synthetic-handover-password'};
  const setup=await call('/auth/setup',{method:'POST',data:{...login,timezone:'UTC',locale:'en',acknowledgedLocalUse:true}});
  const parent={cookie:setup.response.headers.get('set-cookie').split(';')[0],csrf:setup.body.csrf};
  const child=(await call('/children',{...parent,method:'POST',data:{alias:'Synthetic profile',ageBand:'6-8',locale:'en',localConfirmation:true}})).body;
  const deviceA=randomUUID(),deviceB=randomUUID(),basePath=`/children/${child.id}/recovery`;
  const started=await call(`/children/${child.id}/sessions`,{...parent,method:'POST',key:randomUUID(),data:{task:'search',deviceId:deviceA,environment:{platform:'web',deviceClass:'desktop',input:'pointer',modality:'visual'}}});
  const old={cookie:started.response.headers.get('set-cookie').split(';')[0],csrf:started.body.csrf};
  assert.equal((await call(basePath,{...old,method:'POST',data:{deviceId:deviceA}})).body.code,'PARENT_REQUIRED');
  const nativeLogin=await call('/auth/login',{method:'POST',native:true,data:login});const nativeParent={native:true,token:nativeLogin.body.accessToken};
  const preview=await call(basePath,{...nativeParent,method:'POST',data:{deviceId:deviceB}});assert.equal(preview.body.active.sameDevice,false);assert.equal(preview.response.headers.get('cache-control'),'no-store');
  const path=`${basePath}/${started.body.id}/handover`,key=randomUUID(),data={deviceId:deviceB,acknowledged:true},match=preview.body.active.etag;
  assert.equal((await call(path,{...nativeParent,method:'POST',key,data})).response.status,428);
  const transferred=await call(path,{...nativeParent,method:'POST',key,data,match});assert.equal(transferred.response.status,200);
  assert.equal((await call(`/sessions/${started.body.id}/status`,old)).body.historyOnly,true);
  await stop();await boot(dataDir);
  const retry=await call(path,{...nativeParent,method:'POST',key,data,match});assert.equal(retry.body.replayed,true);assert.equal(retry.body.closedAt,transferred.body.closedAt);
  assert.equal((await call(`${basePath}/${started.body.id}/resume`,{...nativeParent,method:'POST',data:{deviceId:deviceB}})).body.code,'SESSION_DEVICE_MISMATCH');
  const relogin=await call('/auth/login',{method:'POST',data:login});const fresh={cookie:relogin.response.headers.get('set-cookie').split(';')[0],csrf:relogin.body.csrf};
  const restored=await call(`${basePath}/${started.body.id}/resume`,{...fresh,method:'POST',data:{deviceId:deviceA}});assert.equal(restored.response.status,200);assert.equal(restored.body.id,started.body.id);assert.equal(restored.body.closed_reason,'device_handover');assert.equal(restored.body.accessToken,undefined);
  const recovered={cookie:restored.response.headers.get('set-cookie').split(';')[0],csrf:restored.body.csrf};assert.equal((await call('/me',fresh)).response.status,401);
  assert.equal((await call(`/children/${child.id}/sessions`,{...nativeParent,method:'POST',key:randomUUID(),data:{task:'search',deviceId:deviceB,environment:{platform:'ios',deviceClass:'phone',input:'touch',modality:'visual'}}})).body.code,'DAILY_LIMIT');
  const events=completeEvents(started.body.plan);
  for(let i=0;i<events.length;i+=100)assert.equal((await call(`/sessions/${started.body.id}/events`,{...recovered,method:'POST',data:{events:events.slice(i,i+100)}})).response.status,200);
  const result=await call(`/sessions/${started.body.id}/finalize`,{...recovered,method:'POST',data:{lastSeq:events.length}});assert.equal(result.body.historyOnly,true);
  assert.equal((await call('/me',nativeParent)).body.children[0].completedSessions,0);
  const weekly=await call(`/children/${child.id}/weekly`,nativeParent);assert.equal(weekly.body.coverage.historyOnly,1);assert.equal(weekly.body.groups.length,0);

  const released=await call(basePath,{...nativeParent,method:'POST',data:{deviceId:deviceB}});assert.equal(released.body.availableMs,started.body.budget_ms-Math.ceil(result.body.activeMs));
  const exported=await call(`/children/${child.id}/export`,nativeParent);assert.equal(exported.body.sessions[0].handover.reason,'device_handover');for(const value of [deviceA,deviceB,key])assert.equal(JSON.stringify(exported.body).includes(value),false);
  await call(`/children/${child.id}/withdraw`,{...nativeParent,method:'POST',data:{}});assert.equal((await call(path,{...nativeParent,method:'POST',key,data,match})).body.code,'CONSENT_REVOKED');
 }finally{await stop();await rm(dataDir,{recursive:true,force:true})}
});

test('explicit reflection sharing and removal survive restart, native transport, old retries and future exports', {timeout:45000}, async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'focus-sharing-http-'));
 try{
  await boot(dataDir);
  const login={name:'Synthetic sharing family',password:'Synthetic-sharing-2026!'};
  const setup=await call('/auth/setup',{method:'POST',data:{...login,timezone:'UTC',locale:'en',acknowledgedLocalUse:true}});
  let parent={cookie:setup.response.headers.get('set-cookie').split(';')[0],csrf:setup.body.csrf};
  const child=(await call('/children',{...parent,method:'POST',data:{alias:'Synthetic River',ageBand:'15-17',locale:'en',localConfirmation:true}})).body;
  const path=`/children/${child.id}/life-goals`;
  const enter=await call(`/children/${child.id}/enter`,{...parent,method:'POST',data:{}});
  const cp={cookie:enter.response.headers.get('set-cookie').split(';')[0],csrf:enter.body.csrf};
  const choose={contentHash:(await call(path,cp)).body.content.hash,intent:'choose',templateId:'steps',support:'space'};
  let goal=(await call(path,{...cp,method:'POST',key:randomUUID(),data:choose})).body.goal;
  const reflection={outcome:'tried',helpful:'yes',next:'same'};
  assert.equal((await call(`${path}/${goal.id}`,{...cp,method:'PATCH',key:randomUUID(),match:'"1"',data:{action:'reflect',reflection}})).body.code,'SHARING_CHOICE_REQUIRED');
  const none=await call(`${path}/${goal.id}`,{...cp,method:'PATCH',key:randomUUID(),match:'"1"',data:{action:'reflect',sharing:'none'}});
  assert.equal(none.response.status,200);assert.equal(none.body.goal.reflection,null);assert.equal(none.body.goal.reflectionSharing,'not-stored');
  goal=(await call(path,{...cp,method:'POST',key:randomUUID(),data:choose})).body.goal;
  const shareKey=randomUUID(),shared={action:'reflect',sharing:'family',reflection};
  assert.equal((await call(`${path}/${goal.id}`,{...cp,method:'PATCH',key:shareKey,match:'"1"',data:shared})).body.goal.reflectionSharing,'family');
  const loginResult=await call('/auth/login',{method:'POST',data:login});parent={cookie:loginResult.response.headers.get('set-cookie').split(';')[0],csrf:loginResult.body.csrf};
  assert.deepEqual((await call(`/children/${child.id}/export`,parent)).body.life.goals.find(g=>g.id===goal.id).reflection,reflection);
  assert.equal((await call(`${path}/${goal.id}`,{...cp,csrf:'wrong',method:'PATCH',key:randomUUID(),match:'"2"',data:{action:'unshare'}})).body.code,'CSRF_REJECTED');
  const native=await call('/auth/login',{native:true,method:'POST',data:login});const np={native:true,token:native.body.accessToken};
  const entered=await call(`/children/${child.id}/enter`,{...np,method:'POST',data:{}});const nc={native:true,token:entered.body.accessToken};
  const key=randomUUID(),removed=await call(`${path}/${goal.id}`,{...nc,method:'PATCH',key,match:'"2"',data:{action:'unshare'}});
  assert.equal(removed.response.status,200);assert.equal(removed.body.goal.reflectionSharing,'withdrawn');
  await stop();await boot(dataDir);
  assert.equal((await call(`${path}/${goal.id}`,{...nc,method:'PATCH',key,match:'"2"',data:{action:'unshare'}})).body.replayed,true);
  assert.equal((await call(`${path}/${goal.id}`,{...cp,method:'PATCH',key:shareKey,match:'"1"',data:shared})).body.code,'REFLECTION_WITHDRAWN');
  const listed=await call(path,parent);assert.equal(listed.response.headers.get('cache-control'),'no-store');assert.equal(listed.body.sharingPolicy,'reflection-sharing-1');assert.equal(listed.body.goals.every(g=>g.reflection===null),true);
  const exported=await call(`/children/${child.id}/export`,parent);
  assert.equal(JSON.stringify(exported.body.life).includes('"helpful"'),false);
  assert.ok(exported.body.life.actions.some(a=>a.answers_removed));assert.equal(exported.body.life.goals.length,2);
 }finally{await stop();await rm(dataDir,{recursive:true,force:true});}
});

test('family invitations require creator confirmation, preserve member scope across restart, and revoke derived Web/native access', { timeout: 40000 }, async () => {
  const dataDir=await mkdtemp(join(tmpdir(),'focus-members-http-'));
  try {
    await boot(dataDir);
    const credentials={name:'Synthetic member family',password:'Synthetic-owner-member-passphrase!'};
    const setup=await call('/auth/setup',{method:'POST',data:{...credentials,timezone:'UTC',locale:'en',acknowledgedLocalUse:true}});
    const owner={cookie:setup.response.headers.get('set-cookie').split(';')[0],csrf:setup.body.csrf};
    const selected=(await call('/children',{...owner,method:'POST',data:{alias:'Selected child',ageBand:'9-11',locale:'en',localConfirmation:true}})).body;
    const sibling=(await call('/children',{...owner,method:'POST',data:{alias:'Private sibling',ageBand:'15-17',locale:'en',localConfirmation:true}})).body;
    const invitation={childIds:[selected.id],acknowledged:true},key=randomUUID();
    assert.equal((await call('/family/invitations',{...owner,method:'POST',data:invitation,key,csrf:'wrong'})).body.code,'CSRF_REJECTED');
    const issued=await call('/family/invitations',{...owner,method:'POST',data:invitation,key});assert.equal(issued.response.status,201);
    const joinBody={code:issued.body.code,loginName:'second-parent',displayName:'Synthetic second parent',password:'Synthetic-second-parent-passphrase!',acknowledgedLocalUse:true};
    assert.equal((await call('/auth/join',{method:'POST',data:joinBody,customOrigin:'https://untrusted.example'})).body.code,'ORIGIN_REJECTED');
    const joined=await call('/auth/join',{method:'POST',data:joinBody,native:true});assert.equal(joined.response.status,200);assert.equal(joined.response.headers.get('set-cookie'),null);
    const support={native:true,token:joined.body.accessToken},pending=(await call('/me',support)).body;
    assert.equal(pending.member.state,'pending');assert.deepEqual(pending.children,[]);
    assert.equal((await call(`/children/${selected.id}/report`,support)).body.code,'MEMBER_PENDING');
    assert.equal(JSON.stringify((await call('/family/members',support)).body).includes(selected.id),false);
    const memberPath=`/family/members/${pending.member.id}`;
    assert.equal((await call(memberPath,{...owner,method:'POST',data:{action:'approve',acknowledged:true}})).response.status,428);
    assert.equal((await call(memberPath,{...owner,method:'POST',data:{action:'approve',acknowledged:true},match:'"1"'})).response.status,200);
    await stop();await boot(dataDir);
    assert.deepEqual((await call('/me',support)).body.children.map(c=>c.id),[selected.id]);
    assert.equal((await call(`/children/${sibling.id}/report`,support)).response.status,404);
    assert.equal((await call(`/children/${selected.id}/export`,support)).body.code,'OWNER_REQUIRED');
    assert.equal((await call(`/children/${selected.id}/life-goals`,support)).body.code,'OWNER_REQUIRED');
    assert.equal((await call(`/children/${selected.id}/practice-limits`,support)).body.canEdit,false);
    const web=await call('/auth/login',{method:'POST',data:{name:credentials.name,password:joinBody.password,memberLogin:joinBody.loginName}});
    const supportWeb={cookie:web.response.headers.get('set-cookie').split(';')[0],csrf:web.body.csrf};
    const entry=await call(`/children/${selected.id}/enter`,{...support,method:'POST',data:{}});assert.equal(entry.response.status,200);
    const childScope={native:true,token:entry.body.accessToken};
    assert.equal((await call('/family/members',childScope)).body.code,'PARENT_REQUIRED');
    assert.equal((await call(memberPath,{...supportWeb,method:'POST',data:{action:'revoke',acknowledged:true},match:'"2"'})).body.code,'OWNER_REQUIRED');
    assert.equal((await call(memberPath,{...owner,method:'POST',data:{action:'revoke',acknowledged:true},match:'"2"'})).response.status,200);
    assert.equal((await call('/me',childScope)).response.status,401);assert.equal((await call('/me',supportWeb)).response.status,401);
    assert.equal((await call('/me',owner)).body.children.length,2);
    assert.equal((await call('/auth/join',{method:'POST',data:joinBody,native:true})).body.code,'INVITE_UNAVAILABLE');
    const roster=(await call('/family/members',owner)).body;assert.equal(roster.members.find(m=>m.id===pending.member.id).state,'revoked');assert.equal(JSON.stringify(roster).includes(issued.body.code),false);
  } finally {await stop();await rm(dataDir,{recursive:true,force:true});}
});
