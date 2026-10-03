import { build } from 'vite';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publishWebRelease, readWebReleaseState } from '../packages/web-release/index.ts';
import { auditDirectory, auditTrackedFiles } from '../packages/release-safety/public-secret-scan.mjs';

const root = resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--store')) throw new Error('Usage: node scripts/build-web.mjs [--store directory]');
const store = resolve(args[1] || resolve(root, 'dist/web-releases'));
const legacy = resolve(root, 'dist/web');
await auditTrackedFiles(root);
await mkdir(resolve(root, 'dist'), { recursive: true });
let current = await readWebReleaseState(store);
// Preserve the complete previous build before this installation's first managed publication.
if (!current && !args.length && await stat(resolve(legacy, '.vite/manifest.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
  await auditDirectory(legacy);
  await publishWebRelease(legacy, store, { version: 'legacy-local', expected: null });
  current = await readWebReleaseState(store);
}
const expected = current?.current ?? null;
const stage = await mkdtemp(resolve(root, 'dist/.web-build-'));
async function check(script) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(root, script), '--directory', stage], { cwd: root, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`${script} exited ${code}`)));
  });
}
try {
  await build({ configFile: resolve(root, 'vite.config.ts'), build: { outDir: stage, emptyOutDir: true } });
  await check('scripts/audit-web-budget.mjs');
  await check('scripts/build-offline-shell.mjs');
  await auditDirectory(stage);
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const published = await publishWebRelease(stage, store, { version, expected });
  console.log(JSON.stringify({ webRelease: published, store, previousRelease: expected }));
} finally { await rm(stage, { recursive: true, force: true }); }
