import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..'), run = promisify(execFile);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('mobile source archive preserves the exact build input and refuses changed files', async () => {
  const fixture = await mkdtemp(join(root, 'dist/.source-archive-test-'));
  const build = await mkdtemp(join(tmpdir(), 'focus-source-archive-test-'));
  try {
    const files = new Map([
      ['package.json', '{"version":"test"}\n'],
      ['package-lock.json', '{"version":"test"}\n'],
      ['apps/family-mobile/app.config.ts', 'export default { version: "test" };\n'],
      ['apps/family-mobile/src/App.tsx', 'export const version = "test";\n'],
    ]);
    for (const [name, content] of files) {
      await mkdir(dirname(join(build, name)), { recursive: true });
      await writeFile(join(build, name), content);
    }
    const snapshot = { schemaVersion: 1, sourceVersion: 'test', appVersion: 'test', buildDirectory: build, includesFamilyData: false,
      sourceFiles: [...files].map(([path, content]) => ({ path, bytes: Buffer.byteLength(content), sha256: sha256(Buffer.from(content)) })) };
    const snapshotPath = join(fixture, 'snapshot.json'), archive = join(fixture, 'source.tar.gz'), report = join(fixture, 'archive.json');
    await writeFile(snapshotPath, JSON.stringify(snapshot));
    await writeFile(join(build, '.focus-native-source.json'), JSON.stringify(snapshot));
    await run(process.execPath, ['scripts/archive-mobile-source.mjs', '--snapshot', snapshotPath, '--output', archive, '--report', report], { cwd: root });
    const inventory = (await run('/usr/bin/tar', ['-tzf', archive])).stdout.trim().split('\n');
    assert.deepEqual(new Set(inventory), new Set([...files.keys(), '.focus-native-source.json']));
    assert.equal((await run('/usr/bin/tar', ['-xOzf', archive, 'apps/family-mobile/src/App.tsx'])).stdout, files.get('apps/family-mobile/src/App.tsx'));
    const details = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(details.archive.sha256, sha256(await readFile(archive)));
    assert.equal(details.snapshot.sourceFiles, files.size);
    await run(process.execPath, ['scripts/verify-mobile-source-archive.mjs', '--archive', archive, '--snapshot', snapshotPath, '--report', report], { cwd: root });
    const damaged = await readFile(archive); damaged[damaged.length - 4] ^= 1;
    await writeFile(archive, damaged);
    await assert.rejects(run(process.execPath, ['scripts/verify-mobile-source-archive.mjs', '--archive', archive, '--snapshot', snapshotPath, '--report', report], { cwd: root }), /Archive digest mismatch/);

    await writeFile(join(build, 'apps/family-mobile/src/App.tsx'), `changed-${randomUUID()}\n`);
    const rejectedArchive = join(fixture, 'changed.tar.gz'), rejectedReport = join(fixture, 'changed.json');
    await assert.rejects(run(process.execPath, ['scripts/archive-mobile-source.mjs', '--snapshot', snapshotPath, '--output', rejectedArchive, '--report', rejectedReport], { cwd: root }), /Source changed after snapshot/);
    await assert.rejects(stat(rejectedArchive), { code: 'ENOENT' });
    await assert.rejects(stat(rejectedReport), { code: 'ENOENT' });
  } finally {
    await rm(fixture, { recursive: true, force: true });
    await rm(build, { recursive: true, force: true });
  }
});
