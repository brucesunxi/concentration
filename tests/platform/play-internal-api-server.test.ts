import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { PLAY_INTERNAL_OUTPUT_BODY, PLAY_INTERNAL_OUTPUT_FILE } from '../../packages/mobile-release/play-internal-android.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

function start(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ['apps/api/main.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* server still opening its database */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('PLAY_INTERNAL_TEST_SERVER_TIMEOUT');
}

function closed(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.end(); resolve(false); });
    socket.once('error', () => resolve(true));
  });
}

test('API-only preview serves health, ready and authenticated family calls, and refuses the website', { timeout: 60000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'focus-play-api-'));
  const port = 4221;
  const started = start({
    PATH: process.env.PATH, FOCUS_DATA_DIR: dataDir, API_PORT: String(port), STUDIO_PORT: '4224',
    FOCUS_PLAY_INTERNAL_API: '1',
  });
  try {
    const health = await waitFor(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).audience, 'play-internal');
    const ready = await fetch(`http://127.0.0.1:${port}/api/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).audience, 'play-internal');
    const denied = ['/', '/index.html', '/focus-sw.js', '/offline-shell.json', '/assets/app.js', '/studio', '/admin', '/support', '/media/guide.mp3', '/api/studio/me', '/api/support', '/api/admin', '/content-assets/%2e%2e/index.html'];
    for (const path of denied) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const text = await response.text();
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get('content-type')?.includes('application/json'), true, path);
      assert.equal(text.includes('<'), false, path);
      assert.equal(JSON.parse(text).code, 'PLAY_INTERNAL_API_ONLY', path);
    }
    const asset = await fetch(`http://127.0.0.1:${port}/content-assets/${'ab'.repeat(32)}.png`);
    assert.equal(asset.status, 404);
    assert.notEqual((await asset.json()).code, 'PLAY_INTERNAL_API_ONLY');
    const protectedHost = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/health', headers: { host: 'concentration-two.vercel.app' } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(protectedHost.status, 403);
    assert.equal(JSON.parse(protectedHost.body).code, 'HOST_REJECTED');
    const setup = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-focus-client': 'native-local-v1' },
      body: JSON.stringify({ name: 'Play internal synthetic family', password: 'synthetic-play-internal-2026', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true }),
    });
    assert.equal(setup.status, 200);
    const token = (await setup.json()).accessToken as string;
    assert.match(token, /^[a-f0-9]{64}$/);
    const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { authorization: `Bearer ${token}`, 'x-focus-client': 'native-local-v1' } });
    assert.equal(me.status, 200);
    const trust = await fetch(`http://127.0.0.1:${port}/api/content/trust`, { headers: { authorization: `Bearer ${token}`, 'x-focus-client': 'native-local-v1' } });
    assert.equal(trust.status, 200);
    assert.equal((await trust.json()).mode, 'local-development');
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { 'x-focus-client': 'native-local-v1' } });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).code, 'UNAUTHENTICATED');
    assert.equal(await closed(4224), true);
  } finally {
    started.child.kill('SIGTERM');
    await new Promise(resolve => started.child.once('exit', resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('Play internal mode refuses production and the protected host before opening a database', async () => {
  const base = { PATH: process.env.PATH, FOCUS_PLAY_INTERNAL_API: '1', VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'concentration-two.vercel.app' };
  const production = start({ ...base, VERCEL_ENV: 'production', VERCEL_URL: 'concentration-git-play.vercel.app' });
  const protectedHost = start({ ...base, VERCEL_ENV: 'preview', VERCEL_URL: 'concentration-two.vercel.app' });
  const preview = start({ ...base, VERCEL_ENV: 'preview', VERCEL_URL: 'concentration-git-play.vercel.app' });
  const [productionCode, protectedCode, previewCode] = await Promise.all([
    new Promise<number>(resolve => production.child.once('exit', code => resolve(code ?? 1))),
    new Promise<number>(resolve => protectedHost.child.once('exit', code => resolve(code ?? 1))),
    new Promise<number>(resolve => preview.child.once('exit', code => resolve(code ?? 1))),
  ]);
  assert.equal(productionCode, 1);
  assert.match(production.output(), /PLAY_INTERNAL_API_PREVIEW_REQUIRED/);
  assert.equal(protectedCode, 1);
  assert.match(protectedHost.output(), /PLAY_INTERNAL_API_PROTECTED_HOST_FORBIDDEN/);
  assert.equal(previewCode, 1);
  assert.match(preview.output(), /VERCEL_RUNTIME_CONFIG_REQUIRED/);
  assert.doesNotMatch(preview.output(), /PLAY_INTERNAL_API_PROTECTED_HOST_FORBIDDEN/);
});

test('API-only Vercel build publishes no website files and refuses production', async () => {
  const web = join(root, 'dist/web');
  await mkdir(web, { recursive: true });
  await writeFile(join(web, 'index.html'), '<html>website</html>');
  const production = spawn(process.execPath, ['scripts/build-vercel-web.mjs'], { cwd: root, env: { PATH: process.env.PATH, FOCUS_PLAY_INTERNAL_API: '1', VERCEL_ENV: 'production' } });
  const productionCode = await new Promise<number>(resolve => production.once('exit', code => resolve(code ?? 1)));
  assert.equal(productionCode, 1);
  assert.match(await readFile(join(web, 'index.html'), 'utf8'), /website/);
  const preview = spawn(process.execPath, ['scripts/build-vercel-web.mjs'], { cwd: root, env: { PATH: process.env.PATH, FOCUS_PLAY_INTERNAL_API: '1', VERCEL_ENV: 'preview' } });
  let previewOut = '';
  preview.stdout.on('data', chunk => { previewOut += chunk.toString(); });
  const previewCode = await new Promise<number>(resolve => preview.once('exit', code => resolve(code ?? 1)));
  assert.equal(previewCode, 0, previewOut);
  assert.match(previewOut, /"staticFiles":1/);
  assert.match(previewOut, /"outputDirectory":"dist\/web"/);
  const published = (await readdir(web, { recursive: true })).map(entry => entry.toString());
  assert.deepEqual(published, [PLAY_INTERNAL_OUTPUT_FILE]);
  assert.equal(await readFile(join(web, PLAY_INTERNAL_OUTPUT_FILE), 'utf8'), PLAY_INTERNAL_OUTPUT_BODY);
  await assert.rejects(readFile(join(web, 'index.html'), 'utf8'));
  assert.equal(published.some(name => /\.(html|js|css)$/i.test(name) || name.includes('focus-sw')), false);
});
