import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { workerSource, workerVersion } from '../../packages/offline-shell/worker.mjs';
export const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function webFixture(directory: string, label: string, forcedLazyPath?: string) {
  const lazyBody = `export const label=${JSON.stringify(label)};`;
  const lazyPath = forcedLazyPath ?? `assets/lazy-${digest(lazyBody).slice(0, 12)}.js`;
  const mainBody = `export const open=()=>import('/${lazyPath}');`;
  const mainPath = `assets/main-${digest(mainBody).slice(0, 12)}.js`;
  const html = `<!doctype html><title>${label}</title><script type="module" src="/${mainPath}"></script>`;
  const files = new Map([['index.html', html], [mainPath, mainBody], [lazyPath, lazyBody]]);
  const initial = ['index.html', mainPath].sort().map(path => ({ path, bytes: Buffer.byteLength(files.get(path)!), sha256: digest(files.get(path)!) }));
  const totalBytes = initial.reduce((sum, file) => sum + file.bytes, 0);
  const shellAssets = [...initial, { path: lazyPath, bytes: Buffer.byteLength(lazyBody), sha256: digest(lazyBody) }].map(({ path, ...file }) => ({ url: '/' + path, ...file }));
  shellAssets.push({ ...shellAssets.find(file => file.url === '/index.html')!, url: '/' });
  const shell = { schemaVersion: 1, version: workerVersion(shellAssets), assets: shellAssets, totalBytes: totalBytes + Buffer.byteLength(lazyBody) };
  files.set('.vite/manifest.json', JSON.stringify({ 'index.html': { file: mainPath, isEntry: true, dynamicImports: ['lazy.ts'] }, 'lazy.ts': { file: lazyPath, isDynamicEntry: true, imports: ['index.html'] } }));
  files.set('budget.json', JSON.stringify({ totalBytes, limitBytes: 1500000, passed: true, assets: initial }));
  files.set('offline-shell.json', JSON.stringify(shell));
  files.set('focus-sw.js', workerSource(shell));
  for (const [path, body] of files) { await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), body); }
  return { directory, html, lazyPath, lazyBody, mainPath, files };
}
