import { build } from 'vite';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
await Promise.all([mkdir(mediaDir, { recursive: true }), mkdir(contentDir, { recursive: true })]);
let contentAssets = 0;
async function contentAsset(path) {
  const bytes = await readFile(resolve(root, path));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const extension = path.endsWith('.mp3') ? 'mp3' : 'png';
  await writeFile(resolve(contentDir, `${hash}.${extension}`), bytes);
  contentAssets++;
}
for (const name of await readdir(resolve(root, 'src/audio'))) {
  if (name.endsWith('.mp3')) await copyFile(resolve(root, 'src/audio', name), resolve(mediaDir, name));
}
for (const name of await readdir(resolve(root, 'src/audio/content'))) {
  if (name.endsWith('.mp3')) await contentAsset(`src/audio/content/${name}`);
}
for (const path of [
  'src/assets/characters-sheet.png', 'src/assets/objects-sheet.png',
  'packages/visuals/archive/objects-sheet-640-preview.png',
  'packages/visuals/archive/objects-sheet-512-preview.png',
  'packages/visuals/runtime/characters-sheet.png',
  'packages/visuals/runtime/objects-sheet.png',
]) await contentAsset(path);
console.log(JSON.stringify({ staticContentAssets: contentAssets }));
