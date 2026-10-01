import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
for (const name of ['hero-island.png', 'bridge-scene.png', 'characters-sheet.png', 'objects-sheet.png']) {
  test(`generated asset ${name} is present and a non-empty PNG`, async () => {
    const path = resolve(root, 'src/assets', name);
    const [info, bytes] = await Promise.all([stat(path), readFile(path)]);
    assert.ok(info.size > 10000);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
}
