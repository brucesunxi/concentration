import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--directory')) throw new Error('Usage: audit-web-budget.mjs [--directory path]');
const directory = args[1] ? resolve(args[1]) : resolve(import.meta.dirname, '../dist/web-candidate');
const manifest = JSON.parse(await readFile(resolve(directory, '.vite/manifest.json'), 'utf8'));
const seen = new Set(), files = new Set(['index.html']);
function visit(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const entry = manifest[key];
  if (!entry) throw new Error(`Missing static dependency: ${key}`);
  files.add(entry.file);
  for (const file of [...entry.css ?? [], ...entry.assets ?? []]) files.add(file);
  for (const dependency of entry.imports ?? []) visit(dependency);
  // Dynamic imports belong to a later action, not the initial page graph.
}
const entries = Object.entries(manifest).filter(([, entry]) => entry.isEntry);
if (entries.length !== 1) throw new Error('Revisit the first-screen budget for multiple entry pages');
visit(entries[0][0]);
for (const [key, entry] of Object.entries(manifest)) {
  if (key.startsWith('../../src/assets/') && files.has(entry.file)) throw new Error('Historical artwork entered the current first-screen graph');
}
for (const name of ['characters', 'objects']) {
  const preview = manifest[`../../packages/visuals/runtime/${name}-sheet.webp`];
  if (!preview || !files.has(preview.file)) throw new Error(`Lossless ${name} preview is missing from the first-screen graph`);
  const png = manifest[`../../packages/visuals/runtime/${name}-sheet.png`];
  if (png && files.has(png.file)) throw new Error(`Full-size ${name} PNG entered the first-screen graph`);
}
const assets = [];
for (const file of [...files].sort()) {
  const bytes = await readFile(resolve(directory, file));
  assets.push({ path: file, bytes: bytes.length, gzipBytes: /\.(html|css|js)$/.test(file) ? gzipSync(bytes).length : bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const totalBytes = assets.reduce((sum, a) => sum + a.bytes, 0), limitBytes = 1500000;
const report = { schemaVersion: 1, scope: 'Conservative static dependency graph including all current home artwork. Excludes API responses, request headers, and action-triggered dynamic pages or legacy content. Not a browser or loading-time measurement.', compressionRequiredToPass: false, totalBytes, estimatedGzipBytes: assets.reduce((sum, a) => sum + a.gzipBytes, 0), limitBytes, passed: totalBytes <= limitBytes, assets };
await writeFile(resolve(directory, 'budget.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ totalBytes, limitBytes, passed: report.passed, compressionRequiredToPass: false }, null, 2));
if (!report.passed) throw new Error('First-screen static resource budget exceeded');
