import { cp, mkdir, mkdtemp, access, readFile, readdir, lstat, statfs, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// An ASCII path avoids legacy Ruby tool failures with the source directory's
// invisible character. Only this allowlist is copied: no .env or family data.
const root = fileURLToPath(new URL('../', import.meta.url));
const checkSpaceOnly = process.argv.length === 3 && process.argv[2] === '--check-space';
if (process.argv.length > 2 && !checkSpaceOnly) {
  throw new Error('Usage: npm run mobile:prepare-build [-- --check-space]');
}
const minimumFreeGiB = 10;
const freeSpace = await statfs(tmpdir(), { bigint: true });
const availableBytes = freeSpace.bavail * freeSpace.bsize;
const minimumBytes = BigInt(minimumFreeGiB) * 1024n ** 3n;
const availableGiB = Number((availableBytes * 100n) / (1024n ** 3n)) / 100;
if (checkSpaceOnly) {
  console.log(JSON.stringify({ temporaryDirectory: tmpdir(), availableGiB, minimumFreeGiB, ready: availableBytes >= minimumBytes }, null, 2));
  process.exit(0);
}
if (availableBytes < minimumBytes) {
  throw new Error(`Native build preparation needs at least ${minimumFreeGiB} GiB free in ${tmpdir()} (${availableGiB} GiB available). Review old build directories before retrying; this command will not remove them.`);
}
await access(join(root, 'node_modules'));
const target = await mkdtemp(join(tmpdir(), 'focus-native-build-'));
await mkdir(join(target, 'apps/family-mobile'), { recursive: true });
await mkdir(join(target, 'scripts'));
const sourceFiles = [];
async function record(relative) {
  const path = join(target, relative), stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await record(join(relative, name));
  } else {
    const bytes = await readFile(path);
    sourceFiles.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
const roots = ['package.json', 'package-lock.json', 'tsconfig.json', 'packages', 'scripts/mobile.mjs'];
for (const name of roots) {
  await cp(join(root, name), join(target, name), { recursive: true });
  await record(name);
}
for (const name of ['package.json', 'build-identity.json', 'app.config.ts', 'metro.config.cjs', 'tsconfig.json', 'Gemfile', 'index.ts', 'src']) {
  await cp(join(root, 'apps/family-mobile', name), join(target, 'apps/family-mobile', name), { recursive: true });
  await record(join('apps/family-mobile', name));
}
try {
  await cp(join(root, 'apps/family-mobile/Gemfile.lock'), join(target, 'apps/family-mobile/Gemfile.lock'));
  await record('apps/family-mobile/Gemfile.lock');
}
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const relative of ['node_modules', 'apps/family-mobile/node_modules']) {
  try { await access(join(root, relative)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (process.platform === 'darwin') {
    const result = spawnSync('cp', ['-cR', join(root, relative), join(target, relative)], { stdio: 'inherit' });
    if (result.status !== 0) throw result.error ?? new Error(`Dependency copy failed: ${relative}`);
  } else await cp(join(root, relative), join(target, relative), { recursive: true, verbatimSymlinks: true });
}
const manifestPath = join(target, '.focus-native-source.json');
await writeFile(manifestPath, JSON.stringify({
  schemaVersion: 1,
  sourceVersion: JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).version,
  appVersion: JSON.parse(await readFile(join(target, 'apps/family-mobile/package.json'), 'utf8')).version,
  preparedAt: new Date().toISOString(), buildDirectory: target, sourceFiles, includesFamilyData: false,
}, null, 2) + '\n');
console.log(JSON.stringify({ buildDirectory: target, source: 'apps/family-mobile', sourceSnapshot: manifestPath, includesFamilyData: false }, null, 2));
