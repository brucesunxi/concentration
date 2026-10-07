import test from 'node:test';
import assert from 'node:assert/strict';
import { webGraphFiles } from '../packages/offline-shell/manifest-files.mjs';

test('offline shell keeps later page code without downloading historical stimulus images', () => {
  const graph = {
    'index.html': { file: 'assets/main-12345678.js', assets: ['assets/preview-12345678.webp'], dynamicImports: ['page.tsx'] },
    'page.tsx': { file: 'assets/page-12345678.js', css: ['assets/page-12345678.css'], imports: ['shared.js'] },
    'shared.js': { file: 'assets/shared-12345678.js', assets: ['assets/historical-12345678.png'] },
  };
  const { initial, offline } = webGraphFiles(graph, 'index.html');
  assert.deepEqual([...initial].sort(), ['assets/main-12345678.js', 'assets/preview-12345678.webp', 'index.html']);
  assert.deepEqual([...offline].sort(), [
    'assets/main-12345678.js', 'assets/page-12345678.css', 'assets/page-12345678.js',
    'assets/preview-12345678.webp', 'assets/shared-12345678.js', 'index.html',
  ]);
  assert.throws(() => webGraphFiles({ 'index.html': { file: 'assets/main.js', dynamicImports: ['missing.tsx'] } }, 'index.html'), /Missing static dependency/);
});
