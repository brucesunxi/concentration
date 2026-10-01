import { build } from 'vite';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/web');

async function check(script) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(root, script), '--directory', output], { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${script} exited ${code}`)));
  });
}

await build({ configFile: resolve(root, 'vite.config.ts'), build: { outDir: output, emptyOutDir: true } });
await check('scripts/audit-web-budget.mjs');
await check('scripts/build-offline-shell.mjs');

const mediaDir = resolve(output, 'media'), contentDir = resolve(output, 'content-assets');
// A static file here would take precedence over the release-state API rewrite.
try {
  await stat(contentDir);
  throw new Error('Content assets must not be present in the static Vercel output');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(mediaDir, { recursive: true });
for (const name of await readdir(resolve(root, 'src/audio'))) {
  if (name.endsWith('.mp3')) await copyFile(resolve(root, 'src/audio', name), resolve(mediaDir, name));
}
console.log(JSON.stringify({ contentAssetsViaApi: true }));
