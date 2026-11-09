import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPlayInternalSourceFiles } from '../packages/mobile-release/play-internal-source.mjs';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
assert(process.argv.length === 3, 'Usage: node scripts/snapshot-mobile-source.mjs <output.json>');
const output = resolve(process.argv[2]);
assert(output.startsWith(root + sep), 'Snapshot output must be inside the workspace');
const entries = await listPlayInternalSourceFiles(root);
assert(entries.length > 100 && entries.includes('apps/family-mobile/src/App.tsx'), 'Mobile source list is incomplete');
const sourceFiles = [];
for (const path of entries) {
  assert(!isAbsolute(path) && !path.split(/[\\/]/).includes('..'), 'Unsafe source path');
  const file = join(root, path);
  assert((await lstat(file)).isFile(), `Source is not a regular file: ${path}`);
  const bytes = await readFile(file);
  sourceFiles.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const sourceVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const appVersion = JSON.parse(await readFile(join(root, 'apps/family-mobile/package.json'), 'utf8')).version;
const snapshot = { schemaVersion: 1, sourceVersion, appVersion, preparedAt: new Date().toISOString(),
  buildDirectory: null, sourceFiles, includesFamilyData: false };
await mkdir(dirname(output), { recursive: true });
assert((await realpath(dirname(output))).startsWith(root + sep), 'Snapshot output directory escaped workspace');
await writeFile(output, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ snapshot: relative(root, output), sourceFiles: entries.length, includesFamilyData: false }));
