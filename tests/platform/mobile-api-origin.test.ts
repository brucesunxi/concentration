import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mobileApiOrigin } from '../../packages/contracts/mobile-api-origin.ts';
import { mobileApiOrigin as playMobileApiOrigin } from '../../packages/contracts/mobile-api-origin-play.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { metroModuleName } = createRequire(import.meta.url)('../../packages/mobile-release/metro-play-internal.cjs') as {
  metroModuleName(name: string, distribution: string | undefined): string;
};

test('native API origin defaults to local simulator routing and accepts a public HTTPS endpoint', () => {
  assert.deepEqual(mobileApiOrigin(undefined), { origin: 'http://localhost:4181', local: true });
  assert.deepEqual(mobileApiOrigin('https://family.example.test/'), { origin: 'https://family.example.test', local: false });
  assert.deepEqual(mobileApiOrigin('http://127.0.0.1:4181'), { origin: 'http://127.0.0.1:4181', local: true });
});

test('Play internal origin resolution has no localhost fallback', () => {
  const preview = 'https://concentration-git-cursor-play-inter-671ee9-brucesunxis-projects.vercel.app';
  assert.deepEqual(playMobileApiOrigin(preview), { origin: preview, local: false });
  assert.throws(() => playMobileApiOrigin(undefined), /MOBILE_API_ORIGIN_REQUIRED/);
  assert.throws(() => playMobileApiOrigin('http://localhost:4181'), /MOBILE_API_ORIGIN_HTTPS_REQUIRED/);
  assert.throws(() => playMobileApiOrigin('http://127.0.0.1:4181'), /MOBILE_API_ORIGIN_HTTPS_REQUIRED/);
  const marker = 'http://localhost:4181';
  const playSource = readFileSync(new URL('../../packages/contracts/mobile-api-origin-play.ts', import.meta.url), 'utf8');
  const parserSource = readFileSync(new URL('../../packages/contracts/parse-mobile-api-origin.ts', import.meta.url), 'utf8');
  assert.equal(playSource.includes(marker), false);
  assert.equal(parserSource.includes(marker), false);
  assert.equal(metroModuleName('../../../packages/contracts/mobile-api-origin.ts', 'play-internal'), '../../../packages/contracts/mobile-api-origin-play.ts');
  assert.equal(metroModuleName('../../../packages/contracts/mobile-api-origin.ts', 'local'), '../../../packages/contracts/mobile-api-origin.ts');
  assert.equal(metroModuleName('../../../packages/contracts/mobile-api-origin-play.ts', 'play-internal'), '../../../packages/contracts/mobile-api-origin-play.ts');
  const metro = readFileSync(new URL('../../apps/family-mobile/metro.config.cjs', import.meta.url), 'utf8');
  assert.match(metro, /metroModuleName\(reactName, process\.env\.FOCUS_ANDROID_DISTRIBUTION\)/);
});

function bundledSources(distribution: 'play-internal' | 'local'): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const visit = (file: string) => {
    const full = resolve(file);
    if (seen.has(full) || !full.startsWith(root)) return;
    seen.add(full);
    let source: string;
    try { source = readFileSync(full, 'utf8'); }
    catch { return; }
    files.push(full);
    const body = source.replace(/import\s+type\s+[^;]+;?/g, '').replace(/export\s+type\s+[^;]+;?/g, '');
    for (const match of body.matchAll(/(?:from|import)\s*\(\s*['"]([^'"]+)['"]|from\s+['"]([^'"]+)['"]/g)) {
      const spec = metroModuleName(match[1] ?? match[2], distribution);
      if (!spec.startsWith('.')) continue;
      const base = resolve(dirname(full), spec);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts'), join(base, 'index.tsx')];
      const found = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      if (found) visit(found);
    }
  };
  visit(join(root, 'apps/family-mobile/index.ts'));
  return files;
}

test('a Play internal bundle graph does not include the local API fallback', () => {
  const marker = 'http://localhost:4181';
  const playFiles = bundledSources('play-internal');
  assert.ok(playFiles.some(file => file.endsWith('mobile-api-origin-play.ts')));
  assert.ok(playFiles.some(file => file.endsWith('parse-mobile-api-origin.ts')));
  assert.equal(playFiles.some(file => file.endsWith('/mobile-api-origin.ts')), false);
  assert.equal(playFiles.some(file => readFileSync(file, 'utf8').includes(marker)), false);
  const localFiles = bundledSources('local');
  assert.ok(localFiles.some(file => file.endsWith('/mobile-api-origin.ts')));
  assert.ok(localFiles.some(file => readFileSync(file, 'utf8').includes(marker)));
});

test('native API origin rejects insecure remote routes and embedded request data', () => {
  for (const value of ['http://family.example.test', 'ftp://family.example.test', 'https://user:pass@family.example.test', 'https://family.example.test/api', 'https://family.example.test/?token=x', 'https://family.example.test/#x', ' https://family.example.test', '']) {
    assert.throws(() => mobileApiOrigin(value), /MOBILE_API_ORIGIN_/);
  }
});
