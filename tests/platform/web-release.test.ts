import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebReleaseReader, inspectWebBuild, publishWebRelease, readWebReleaseState } from '../../packages/web-release/index.ts';
import { webFixture } from './web-release.fixture.ts';
async function workspace(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'focus-web-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = await webFixture(join(root, 'a'), 'Build A'), b = await webFixture(join(root, 'b'), 'Build B');
  const store = join(root, 'store'), reader = createWebReleaseReader(store, a.directory);
  const first = await publishWebRelease(a.directory, store, { version: 'A', expected: null });
  return { root, a, b, store, reader, first };
}

test('requests already reading the legacy build can finish during the first managed publication', async t => {
  const root = await mkdtemp(join(tmpdir(), 'focus-web-bootstrap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = await webFixture(join(root, 'legacy'), 'Legacy'), next = await webFixture(join(root, 'next'), 'Next');
  const store = join(root, 'store'), reader = createWebReleaseReader(store, legacy.directory);
  assert.equal((await reader('/'))!.bytes.toString(), legacy.html);
  // Production bootstrap imports the legacy generation before publishing a new one.
  const adopting = publishWebRelease(legacy.directory, store, { version: 'legacy', expected: null });
  const responses = await Promise.all(Array.from({ length: 20 }, async () => (await reader('/'))!.bytes.toString()));
  assert.ok(responses.every(html => html === legacy.html));
  const first = await adopting;
  await publishWebRelease(next.directory, store, { version: 'next', expected: first.id });
  assert.equal((await reader('/'))!.bytes.toString(), next.html);
  assert.equal((await reader('/' + legacy.lazyPath))!.bytes.toString(), legacy.lazyBody);
});

test('publishing a new entry preserves the exact lazy module used by an old open page', async t => {
  const { a, b, store, reader, first } = await workspace(t);
  assert.equal((await reader('/'))!.bytes.toString(), a.html);
  const next = await publishWebRelease(b.directory, store, { version: 'B', expected: first.id });
  assert.equal((await reader('/'))!.bytes.toString(), b.html);
  assert.equal((await reader('/' + a.lazyPath))!.bytes.toString(), a.lazyBody);
  assert.equal((await reader('/' + b.lazyPath))!.bytes.toString(), b.lazyBody);
  assert.equal((await reader('/' + a.lazyPath))!.release, first.id);
  assert.equal((await reader('/'))!.release, next.id);
  assert.equal((await reader('/'))!.cacheControl, 'no-store');
  assert.match((await reader('/' + a.lazyPath))!.cacheControl, /immutable/);
  assert.equal(next.retainedReleases, 2);
});

test('private manifests, secrets, release directories and encoded paths never become public static files', async t => {
  const { store, reader, first } = await workspace(t);
  await writeFile(join(first.directory, 'private.json'), '{"secret":"synthetic"}');
  for (const path of ['/.vite/manifest.json', '/current.json', '/.env', '/private.json', `/releases/${first.id}/manifest.json`, '/assets/../current.json', '/assets/%2e%2e/secret.js', '/api/me', '/unknown', '/assets/missing-12345678.js']) assert.equal(await reader(path), null, path);
  assert.equal((await readWebReleaseState(store))!.current, first.id);
});

test('missing lazy files, unsafe graph paths and incomplete offline packages leave the active version intact', async t => {
  const { b, store, reader, first } = await workspace(t);
  await rm(join(b.directory, b.lazyPath));
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: first.id }), /ENOENT/);
  await webFixture(b.directory, 'Build B');
  await writeFile(join(b.directory, 'focus-sw.js'), '/* broken new worker */');
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: first.id }), /SHELL_MISMATCH/);
  await webFixture(b.directory, 'Build B');
  const graph = JSON.parse(await readFile(join(b.directory, '.vite/manifest.json'), 'utf8'));
  graph['lazy.ts'].file = '../private.json';
  await writeFile(join(b.directory, '.vite/manifest.json'), JSON.stringify(graph));
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: first.id }), /UNSAFE_PATH/);
  assert.equal((await reader('/'))!.release, first.id);
});

test('a fabricated or incomplete budget success cannot activate a build', async t => {
  const { b, store, first } = await workspace(t);
  await writeFile(join(b.directory, 'budget.json'), JSON.stringify({ passed: true, totalBytes: 0, limitBytes: 1500000, assets: [] }));
  await assert.rejects(inspectWebBuild(b.directory, 'B'), /BUDGET_FAILED/);
  await webFixture(b.directory, 'Build B');
  const budget = JSON.parse(await readFile(join(b.directory, 'budget.json'), 'utf8')); budget.assets.pop();
  await writeFile(join(b.directory, 'budget.json'), JSON.stringify(budget));
  await assert.rejects(inspectWebBuild(b.directory, 'B'), /BUDGET_MISMATCH/);
  assert.equal((await readWebReleaseState(store))!.current, first.id);
});

test('reusing a public asset URL for different bytes is rejected without damaging old readers', async t => {
  const { a, b, store, reader, first } = await workspace(t);
  await webFixture(b.directory, 'Changed bytes', a.lazyPath);
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: first.id }), /ASSET_COLLISION/);
  assert.equal((await reader('/' + a.lazyPath))!.bytes.toString(), a.lazyBody);
  assert.equal((await reader('/'))!.release, first.id);
});

test('overlapping publishers cannot silently replace a newer release with a stale build', async t => {
  const { root, b, store, first } = await workspace(t), c = await webFixture(join(root, 'c'), 'Build C');
  const results = await Promise.allSettled([publishWebRelease(b.directory, store, { version: 'B', expected: first.id }), publishWebRelease(c.directory, store, { version: 'C', expected: first.id })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.match(rejected.reason.message, /BUSY|STALE_BUILD/);
  const current = (await readWebReleaseState(store))!.current;
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: first.id }), /STALE_BUILD/);
  assert.equal((await readWebReleaseState(store))!.current, current);
});

test('capacity exhaustion and an existing publisher lock preserve the working release', async t => {
  const { b, store, reader, first } = await workspace(t);
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: first.id, maxBytes: 1 }), /CAPACITY/);
  await mkdir(join(store, '.publish-lock'));
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: first.id }), /BUSY/);
  assert.equal((await reader('/'))!.release, first.id);
});

test('a stopped publication can reuse its immutable files, while repeat publication detects corruption', async t => {
  const { b, store, reader, first } = await workspace(t);
  const oldState = await readFile(join(store, 'current.json'));
  const next = await publishWebRelease(b.directory, store, { version: 'B', expected: first.id });
  // Model a stop after the immutable directory was installed but before its pointer was committed.
  await writeFile(join(store, 'current.json'), oldState);
  const recovered = await publishWebRelease(b.directory, store, { version: 'B', expected: first.id });
  assert.equal(recovered.id, next.id); assert.equal(recovered.retainedReleases, 2);
  assert.equal((await reader('/'))!.bytes.toString(), b.html);
  await writeFile(join(recovered.directory, b.lazyPath), 'corrupt');
  await assert.rejects(reader('/' + b.lazyPath), /FILE_CORRUPT/);
  await assert.rejects(publishWebRelease(b.directory, store, { version: 'B', expected: next.id }), /FILE_CORRUPT/);
});

test('symlink assets and corrupt active manifests fail closed instead of using a different build', async t => {
  const { root, b, store, reader, first } = await workspace(t);
  const other = join(root, 'not-public.js'); await writeFile(other, 'synthetic secret');
  await rm(join(b.directory, b.lazyPath)); await symlink(other, join(b.directory, b.lazyPath));
  await assert.rejects(inspectWebBuild(b.directory, 'B'), /UNSAFE_PATH/);
  await reader('/');
  await writeFile(join(store, 'releases', first.id, 'manifest.json'), '{}');
  await assert.rejects(reader('/'));
  await rm(join(store, 'current.json'));
  await assert.rejects(reader('/'), /STATE_MISSING/);
});
