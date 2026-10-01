import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { link, lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  assert(['--snapshot', '--output', '--report'].includes(name) && value && !value.startsWith('--') && !options.has(name), 'Invalid archive arguments');
  options.set(name, resolve(value));
}
for (const name of ['--snapshot', '--output', '--report']) assert(options.has(name), `Missing ${name}`);
const output = options.get('--output'), reportPath = options.get('--report');
assert(options.get('--snapshot').startsWith(root + sep), 'Snapshot must be in the workspace');
assert(output.startsWith(root + sep) && reportPath.startsWith(root + sep) && output !== reportPath && output !== options.get('--snapshot') && reportPath !== options.get('--snapshot'), 'Archive outputs must be distinct workspace files');
assert((await realpath(dirname(output))).startsWith(root + sep) && (await realpath(dirname(reportPath))).startsWith(root + sep), 'Archive output directory escaped workspace');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const snapshotBytes = await readFile(options.get('--snapshot'));
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
assert(snapshot.schemaVersion === 1 && snapshot.includesFamilyData === false && Array.isArray(snapshot.sourceFiles) && snapshot.sourceFiles.length > 0, 'Invalid source snapshot');
const buildRoot = await realpath(snapshot.buildDirectory);
assert(buildRoot !== root && !buildRoot.startsWith(root + sep), 'Build directory is not isolated');
assert((await readFile(join(buildRoot, '.focus-native-source.json'))).equals(snapshotBytes), 'Build snapshot differs from delivery snapshot');
const paths = new Set();
for (const entry of snapshot.sourceFiles) {
  assert(typeof entry.path === 'string' && !isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..') && !entry.path.startsWith('-'), 'Unsafe archive path');
  assert(!paths.has(entry.path), 'Duplicate archive path'); paths.add(entry.path);
  const path = join(buildRoot, entry.path);
  assert((await realpath(path)).startsWith(buildRoot + sep) && (await lstat(path)).isFile(), `Source path escaped build: ${entry.path}`);
  const bytes = await readFile(path);
  assert(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, `Source changed after snapshot: ${entry.path}`);
}
for (const required of ['package.json', 'package-lock.json', 'apps/family-mobile/app.config.ts', 'apps/family-mobile/src/App.tsx']) assert(paths.has(required), `Missing archive source: ${required}`);
const temporary = output + '.partial-' + randomUUID();
try {
  execFileSync('/usr/bin/tar', ['-czf', temporary, '-C', buildRoot, ...paths, '.focus-native-source.json'], { maxBuffer: 1024 * 1024 });
  const archived = execFileSync('/usr/bin/tar', ['-tzf', temporary], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n').map(name => name.replace(/^\.\//, ''));
  assert(archived.length === paths.size + 1 && new Set(archived).size === archived.length && archived.every(name => paths.has(name) || name === '.focus-native-source.json'), 'Archive inventory differs from snapshot');
  const extracted = await mkdtemp(join(tmpdir(), 'focus-source-archive-check-'));
  try {
    execFileSync('/usr/bin/tar', ['-xzf', temporary, '-C', extracted], { maxBuffer: 1024 * 1024 });
    assert((await readFile(join(extracted, '.focus-native-source.json'))).equals(snapshotBytes), 'Archived snapshot changed');
    for (const entry of snapshot.sourceFiles) {
      const bytes = await readFile(join(extracted, entry.path));
      assert(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, `Archived source differs from snapshot: ${entry.path}`);
    }
  } finally { await rm(extracted, { recursive: true, force: true }); }
  const bytes = await readFile(temporary);
  const report = { schemaVersion: 1, sourceVersion: snapshot.sourceVersion, appVersion: snapshot.appVersion,
    archive: { path: output.slice(root.length + 1), bytes: bytes.length, sha256: sha256(bytes) },
    snapshot: { path: options.get('--snapshot').slice(root.length + 1), sha256: sha256(snapshotBytes), sourceFiles: paths.size },
    includesFamilyData: false };
  assert(!(await stat(reportPath).then(() => true).catch(error => error.code === 'ENOENT' ? false : Promise.reject(error))), 'Archive report already exists');
  await link(temporary, output);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
} finally { await rm(temporary, { force: true }); }
