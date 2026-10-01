import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..'), directory = resolve(root, 'packages/visuals');
const checkOnly = process.argv.includes('--check');
if (process.argv.some(arg => arg.startsWith('--') && arg !== '--check')) throw new Error('Usage: node scripts/build-visuals.mjs [--check]');
const source = JSON.parse(await readFile(resolve(directory, 'source.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const retained of source.retainedPreviewAssets) {
  const bytes = await readFile(resolve(directory, retained.path));
  if (hash(bytes) !== retained.sha256 || bytes.length !== retained.bytes) throw new Error(`A frozen historical asset was modified: ${retained.path}`);
}
const outputs = [];
for (const asset of source.assets) {
  const master = await readFile(resolve(directory, asset.master));
  const metadata = await sharp(master).metadata();
  if (!metadata.hasAlpha || metadata.format !== 'png') throw new Error(`Expected transparent PNG master: ${asset.id}`);
  for (const output of asset.exports) {
    if (output.format === 'webp' && (!Number.isInteger(output.quality) || output.quality < 1 || output.quality > 100)) throw new Error(`WebP quality must be explicit: ${output.path}`);
    const pipeline = sharp(master).resize({ width: output.width, withoutEnlargement: true, kernel: 'lanczos3' });
    const encoded = output.format === 'png' ? pipeline.png({ compressionLevel: 9 }) : pipeline.webp({ quality: output.quality, alphaQuality: 100, effort: 6 });
    const bytes = await encoded.toBuffer();
    if (checkOnly && !(await readFile(resolve(directory, output.path))).equals(bytes)) throw new Error(`Delivery bytes differ from the declared source and encoder: ${output.path}`);
    const info = await sharp(bytes).metadata();
    if (info.width !== output.width || !info.hasAlpha || info.format !== output.format || info.height !== Math.round(metadata.height * output.width / metadata.width)) throw new Error(`Invalid delivery format: ${output.path}`);
    if (bytes.length > output.maxBytes) throw new Error(`Media budget exceeded: ${output.path}`);
    const { data, info: raw } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cells = [];
    if (asset.cells) {
      if (raw.width !== raw.height || raw.width % 2) throw new Error('Sprite atlas must have four equal square cells');
      const side = raw.width / 2;
      for (let index = 0; index < 4; index++) {
        const ox = index % 2 * side, oy = Math.floor(index / 2) * side;
        let left = side, top = side, right = -1, bottom = -1;
        for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
          // Ignore faint texture; substantive image pixels may not meet a crop edge.
          if (data[((oy + y) * raw.width + ox + x) * 4 + 3] < 64) continue;
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        if (right < left || Math.min(left, top, side - 1 - right, side - 1 - bottom) < 2) throw new Error(`Missing or clipped stimulus: ${asset.cells[index]}`);
        cells.push({ item: asset.cells[index], index, bounds: { left, top, right, bottom }, cellPixels: side });
      }
    }
    const entry = { id: asset.id, path: output.path, format: info.format, width: info.width, height: info.height, bytes: bytes.length, sha256: hash(bytes), sourceSha256: hash(master), review: source.review, ...(output.format === 'webp' ? { quality: output.quality } : {}), ...(cells.length ? { cells } : {}) };
    outputs.push({ entry, bytes });
  }
}
const webPaths = ['runtime/hero-island.webp', 'runtime/bridge-scene.webp', 'runtime/characters-sheet.png', 'runtime/objects-sheet.png'];
const webImageBytes = outputs.filter(o => webPaths.includes(o.entry.path)).reduce((sum, o) => sum + o.bytes.length, 0);
if (webImageBytes > 1250000) throw new Error(`Web image budget exceeded: ${webImageBytes}`);
const manifest = { schemaVersion: 1, version: source.version, encoder: { sharp: sharp.versions.sharp, vips: sharp.versions.vips }, webImageBytes, retainedAssets: source.retainedPreviewAssets, assets: outputs.map(o => o.entry) };
if (checkOnly) {
  const expected = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  // Exact output bytes are checked above; the recorded encoder version remains provenance metadata.
  if (JSON.stringify({ ...manifest, encoder: expected.encoder }) !== JSON.stringify(expected)) throw new Error('Manifest differs from the checked-in artwork or source. Rebuild and review a new content version.');
} else {
  await mkdir(resolve(directory, 'runtime'), { recursive: true });
  for (const { entry, bytes } of outputs) await writeFile(resolve(directory, entry.path), bytes);
  await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
console.log(JSON.stringify({ mode: checkOnly ? 'verified' : 'built', version: source.version, outputs: outputs.length, webImageBytes, note: 'Hashes, dimensions, alpha, cell crop margins and byte budgets only. Human identification and app UI review remain pending.' }, null, 2));
