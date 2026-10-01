import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  assert(['--archive', '--snapshot', '--report'].includes(name) && value && !value.startsWith('--') && !args.has(name), 'Invalid verification arguments');
  args.set(name, resolve(value));
}
for (const name of ['--archive', '--snapshot', '--report']) assert(args.has(name), `Missing ${name}`);
for (const path of args.values()) assert(path.startsWith(root + sep) && (await realpath(path)).startsWith(root + sep), 'Verification input escaped workspace');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const archive = args.get('--archive'), archiveBytes = await readFile(archive);
const snapshotBytes = await readFile(args.get('--snapshot'));
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const report = JSON.parse(await readFile(args.get('--report'), 'utf8'));
assert(snapshot.schemaVersion === 1 && snapshot.includesFamilyData === false && Array.isArray(snapshot.sourceFiles), 'Invalid source snapshot');
assert(report.schemaVersion === 1 && report.includesFamilyData === false && report.sourceVersion === snapshot.sourceVersion && report.appVersion === snapshot.appVersion, 'Archive report identity mismatch');
assert(resolve(root, report.archive.path) === archive && report.archive.bytes === archiveBytes.length && report.archive.sha256 === digest(archiveBytes), 'Archive digest mismatch');
assert(resolve(root, report.snapshot.path) === args.get('--snapshot') && report.snapshot.sha256 === digest(snapshotBytes) && report.snapshot.sourceFiles === snapshot.sourceFiles.length, 'Snapshot digest mismatch');
const expected = new Set(['.focus-native-source.json']);
for (const entry of snapshot.sourceFiles) {
  assert(typeof entry.path === 'string' && !isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..') && !entry.path.startsWith('-'), 'Unsafe source path');
  assert(!expected.has(entry.path), 'Duplicate source path'); expected.add(entry.path);
}
const list = execFileSync('/usr/bin/tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n').map(name => name.replace(/^\.\//, ''));
assert(list.length === expected.size && list.every(name => expected.has(name)) && new Set(list).size === expected.size, 'Archive inventory mismatch');
const listing = execFileSync('/usr/bin/tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n');
assert(listing.length === expected.size && listing.every(line => line.startsWith('-')), 'Archive contains links or non-file entries');
const extracted = await realpath(await mkdtemp(join(tmpdir(), 'focus-source-archive-verify-')));
try {
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', extracted], { maxBuffer: 1024 * 1024 });
  assert((await readFile(join(extracted, '.focus-native-source.json'))).equals(snapshotBytes), 'Embedded snapshot differs');
  for (const entry of snapshot.sourceFiles) {
    const path = join(extracted, entry.path);
    assert((await realpath(path)).startsWith(extracted + sep) && (await lstat(path)).isFile(), `Unsafe extracted source: ${entry.path}`);
    const bytes = await readFile(path);
    assert(bytes.length === entry.bytes && digest(bytes) === entry.sha256, `Archived source hash mismatch: ${entry.path}`);
  }
} finally { await rm(extracted, { recursive: true, force: true }); }
console.log(JSON.stringify({ sourceVersion: snapshot.sourceVersion, files: snapshot.sourceFiles.length, archiveSha256: report.archive.sha256, verified: true }));
