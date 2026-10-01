// Static asset inspection at display sizes. This is never an app screenshot.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..'), width = 840, height = 540;
const base = Buffer.from(`<svg width="840" height="540" xmlns="http://www.w3.org/2000/svg"><rect width="840" height="540" fill="#fbfcf7"/><g fill="#263b2d" font-family="Arial,sans-serif"><text x="24" y="32" font-size="20">v0.7 raster asset proof — not an app screenshot</text><text x="24" y="62" font-size="14">Character cells at 56 px / 96 px · memory cells at 56 px / 80 px</text><text x="24" y="504" font-size="13">Alpha preserved. Fixed cell order. Human identification and device testing pending.</text></g></svg>`);
const overlays = [{ input: base, left: 0, top: 0 }];
for (const [name, ys, sizes] of [['characters-sheet', [85, 173], [56, 96]], ['objects-sheet', [300, 380], [56, 80]]]) {
  const file = resolve(root, `packages/visuals/runtime/${name}.png`), info = await sharp(file).metadata(), half = info.width / 2;
  for (let row = 0; row < 2; row++) for (let index = 0; index < 4; index++) overlays.push({
    input: await sharp(file).extract({ left: index % 2 * half, top: Math.floor(index / 2) * half, width: half, height: half }).resize(sizes[row], sizes[row]).png().toBuffer(), left: 24 + index * 120, top: ys[row],
  });
}
overlays.push({ input: await sharp(resolve(root, 'packages/visuals/runtime/hero-island.webp')).resize(240, 240).png().toBuffer(), left: 565, top: 85 });
overlays.push({ input: await sharp(resolve(root, 'packages/visuals/runtime/bridge-scene.webp')).resize(250, 125).png().toBuffer(), left: 550, top: 350 });
await mkdir(resolve(root, 'docs/productization/qa'), { recursive: true });
await sharp({ create: { width, height, channels: 4, background: '#fbfcf7' } }).composite(overlays).png().toFile(resolve(root, 'docs/productization/qa/visual-v0.7-contact.png'));
