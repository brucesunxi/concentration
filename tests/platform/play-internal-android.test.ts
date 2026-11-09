import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  PLAY_INTERNAL_APP_NAME,
  PLAY_INTERNAL_MIN_VERSION_CODE,
  PLAY_INTERNAL_UPLOAD_CERT_SHA256,
  PLAY_INTERNAL_UPLOAD_KEY_ALIAS,
  PROTECTED_PREVIEW_HOST,
  androidAppIdentity,
  assertPlayInternalBundle,
  assertPlayInternalHealthReport,
  assertPlayInternalManifest,
  assertPlayInternalServiceSeparation,
  playInternalLocalBuildInputs,
  playInternalPreviewHosts,
  assertPlayInternalSigner,
  assertSecretsNotPackaged,
  assessPlayInternalHealth,
  familyPreviewStatus,
  playInternalApiOrigin,
  playInternalCertificateSha256,
  PLAY_INTERNAL_OUTPUT_BODY,
  PLAY_INTERNAL_OUTPUT_FILE,
  playInternalEdgeDecision,
  playInternalPreviewPath,
  playInternalPrerequisites,
  resolveDeploymentRequest,
} from '../../packages/mobile-release/play-internal-android.ts';
import {
  mobileAgeReviewAcknowledgement,
  mobileCreateAcknowledgement,
  mobileHostedServiceNotice,
  mobilePreviewStatus,
  mobileProfileAcknowledgement,
  HOSTED_TEST_SERVICE_MARKER,
} from '../../packages/session-runtime/mobile-preview-copy.ts';

const password = 'sentinel-play-password-not-a-real-secret';
const signing = {
  FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64: 'AAAA',
  FOCUS_PLAY_UPLOAD_STORE_PASSWORD: password,
  FOCUS_PLAY_UPLOAD_KEY_ALIAS: PLAY_INTERNAL_UPLOAD_KEY_ALIAS,
  FOCUS_PLAY_UPLOAD_KEY_PASSWORD: password,
  FOCUS_UPLOAD_STORE_FILE: '/tmp/focus-play-upload.p12',
  EXPO_PUBLIC_FOCUS_API_ORIGIN: 'https://family.example.test',
  FOCUS_ANDROID_DISTRIBUTION: 'play-internal',
};

test('local Android builds stay on the debug localhost path when Play settings are absent', () => {
  const identity = androidAppIdentity({});
  assert.deepEqual(identity, {
    distribution: 'local', name: 'Focus Island Dev', origin: 'http://localhost:4181', local: true,
  });
  const untouched = androidAppIdentity({ ...signing, FOCUS_ANDROID_DISTRIBUTION: undefined });
  assert.equal(untouched.distribution, 'local');
  assert.equal(untouched.name, 'Focus Island Dev');
  assert.equal(JSON.stringify(untouched).includes(password), false);
});

test('Play internal config requires a non-local HTTPS origin and refuses production mode', () => {
  assert.throws(() => androidAppIdentity({ APP_MODE: 'production' }), /Mobile production release requires approved identity/);
  assert.throws(() => androidAppIdentity({ ...signing, EXPO_PUBLIC_FOCUS_API_ORIGIN: 'http://localhost:4181' }), /PLAY_INTERNAL_HTTPS_API_REQUIRED/);
  assert.throws(() => androidAppIdentity({ ...signing, EXPO_PUBLIC_FOCUS_API_ORIGIN: 'http://family.example.test' }), /MOBILE_API_ORIGIN_HTTPS_REQUIRED/);
  assert.throws(() => androidAppIdentity({ ...signing, EXPO_PUBLIC_FOCUS_API_ORIGIN: `https://${PROTECTED_PREVIEW_HOST}` }), /PLAY_INTERNAL_PROTECTED_PREVIEW_FORBIDDEN/);
  assert.throws(() => androidAppIdentity({ ...signing, FOCUS_PLAY_UPLOAD_STORE_PASSWORD: '' }), /PLAY_INTERNAL_SIGNING_CONFIG_MISSING:FOCUS_PLAY_UPLOAD_STORE_PASSWORD/);
  try {
    androidAppIdentity({ ...signing, FOCUS_PLAY_UPLOAD_STORE_PASSWORD: '' });
  } catch (error) {
    assert.equal(error instanceof Error && error.message.includes(password), false);
  }
  const ready = androidAppIdentity(signing);
  assert.equal(ready.name, PLAY_INTERNAL_APP_NAME);
  assert.equal(ready.local, false);
  assert.equal(ready.origin, 'https://family.example.test');
  assert.equal(JSON.stringify(ready).includes(password), false);
});

test('Play internal prerequisites name missing repository settings and do not echo secret values', () => {
  assert.throws(() => playInternalPrerequisites({ ...signing, FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64: '   ' }), /FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64/);
  assert.throws(() => playInternalPrerequisites({ ...signing, FOCUS_PLAY_UPLOAD_KEY_ALIAS: 'upload' }), /PLAY_INTERNAL_KEY_ALIAS_UNEXPECTED/);
  assert.throws(() => playInternalPrerequisites({ ...signing, FOCUS_PLAY_UPLOAD_CERT_SHA256: 'abcd' }), /PLAY_INTERNAL_CERT_SHA256_INVALID/);
  assert.throws(() => playInternalPrerequisites({ ...signing, FOCUS_PLAY_UPLOAD_CERT_SHA256: 'ab'.repeat(32) }), /PLAY_INTERNAL_CERT_SHA256_MISMATCH/);
  const ready = playInternalPrerequisites(signing);
  assert.equal(ready.origin, 'https://family.example.test');
  assert.equal(ready.certificateSha256, PLAY_INTERNAL_UPLOAD_CERT_SHA256);
  assert.equal(playInternalCertificateSha256('84:71:40:6A:C1:96:EE:35:8F:77:7E:E2:57:4C:86:A9:4D:6B:E8:6E:EA:0D:50:FD:4E:1C:24:2F:8F:48:94:FA'), PLAY_INTERNAL_UPLOAD_CERT_SHA256);
  assert.equal(JSON.stringify(ready).includes(password), false);
});

test('a protected redirect or non-preview health response cannot satisfy the Play internal API check', () => {
  assert.match(readFileSync(new URL('../../scripts/deployment-identity.mjs', import.meta.url), 'utf8'), new RegExp(`export const PROTECTED_PREVIEW_ALIAS = '${PROTECTED_PREVIEW_HOST}'`));
  assert.throws(() => playInternalApiOrigin(`https://${PROTECTED_PREVIEW_HOST}`), /PLAY_INTERNAL_PROTECTED_PREVIEW_FORBIDDEN/);
  assert.throws(() => assertPlayInternalServiceSeparation({ enabled: '1', vercel: true, environment: 'preview', servingHosts: [PROTECTED_PREVIEW_HOST], productionHost: PROTECTED_PREVIEW_HOST }), /PLAY_INTERNAL_API_PROTECTED_HOST_FORBIDDEN/);
  assert.throws(() => assertPlayInternalServiceSeparation({ enabled: '1', vercel: true, environment: 'production', servingHosts: ['concentration-git-play.vercel.app'], productionHost: PROTECTED_PREVIEW_HOST }), /PLAY_INTERNAL_API_PREVIEW_REQUIRED/);
  assert.deepEqual(assertPlayInternalServiceSeparation({ enabled: undefined, vercel: true, environment: 'production', servingHosts: [PROTECTED_PREVIEW_HOST], productionHost: PROTECTED_PREVIEW_HOST }), []);
  assert.deepEqual(playInternalPreviewHosts(['concentration-git-play.vercel.app'], PROTECTED_PREVIEW_HOST), ['concentration-git-play.vercel.app']);
  const denied = ['/', '/index.html', '/focus-sw.js', '/offline-shell.json', '/assets/index.js', '/studio', '/admin', '/support', '/media/guide.mp3', '/api/studio/me', '/api/admin', '/api/support', '/content-assets/../index.html', `/${PLAY_INTERNAL_OUTPUT_FILE}`];
  for (const path of denied) assert.equal(playInternalPreviewPath(path), 'deny', path);
  assert.equal(playInternalPreviewPath('/api/health'), 'allow');
  assert.equal(playInternalPreviewPath(`/content-assets/${'ab'.repeat(32)}.png`), 'allow');
  assert.equal(playInternalEdgeDecision({ enabled: '1', environment: 'preview', pathname: '/focus-sw.js' }).code, 'PLAY_INTERNAL_API_ONLY');
  assert.equal(playInternalEdgeDecision({ enabled: '1', environment: 'production', pathname: '/' }).action, 'continue');
  assert.equal(playInternalEdgeDecision({ enabled: undefined, environment: 'preview', pathname: '/' }).apiOnly, false);
  const localBuild = playInternalLocalBuildInputs(signing);
  assert.equal(localBuild.origin, 'https://family.example.test');
  assert.equal(JSON.stringify(localBuild).includes(password), false);
  const middleware = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
  assert.match(middleware, /playInternalEdgeDecision/);
  assert.doesNotMatch(middleware, /from\s+['"][^'"]+\.ts['"]/);
  assert.doesNotMatch(middleware, /packages\/mobile-release\/play-internal-android/);
  assert.doesNotMatch(middleware, /x-vercel-protection-bypass|protection-bypass|bypass token/i);
  const localStatus = familyPreviewStatus('0.46.0', 'local-development', {});
  assert.equal('audience' in localStatus, false);
  assert.equal(familyPreviewStatus('0.46.0', 'local-development', { FOCUS_PLAY_INTERNAL_API: '1' }).audience, 'play-internal');
  assert.throws(() => assessPlayInternalHealth({ httpStatus: 302, redirected: true, body: undefined }), /PLAY_INTERNAL_API_UNREACHABLE/);
  assert.throws(() => assessPlayInternalHealth({ httpStatus: 200, redirected: false, body: { status: 'ok', mode: 'local-development', version: '0.46.0' } }), /PLAY_INTERNAL_API_HEALTH_INVALID/);
  const healthy = { status: 'ok', mode: 'local-development', version: '0.46.0', audience: 'play-internal' };
  assert.deepEqual(assessPlayInternalHealth({ httpStatus: 200, redirected: false, body: healthy }), { mode: 'local-development', audience: 'play-internal' });
  const report = assertPlayInternalHealthReport({ origin: 'https://family.example.test', httpStatus: 200, mode: 'local-development', audience: 'play-internal', ready: true, redirected: false }, 'https://family.example.test');
  assert.equal(report.ready, true);
  assert.throws(() => assertPlayInternalHealthReport({ origin: 'https://family.example.test', httpStatus: 200, mode: 'local-development', redirected: false }, 'https://family.example.test'), /PLAY_INTERNAL_API_HEALTH_INVALID/);
});

test('API-only output is nonempty and the SPA rewrite still serves the ordinary website', () => {
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as { outputDirectory: string; rewrites: { source: string; destination: string }[] };
  assert.equal(vercel.outputDirectory, 'dist/web');
  assert.equal(vercel.outputDirectory.split('/').at(-1), 'web');
  assert.deepEqual(vercel.rewrites.at(-1), { source: '/:path*', destination: '/index.html' });
  for (const source of ['/index.html', '/focus-sw.js', '/offline-shell.json', '/budget.json', '/assets/:path*']) {
    const rule = vercel.rewrites.find(item => item.source === source);
    assert.equal(rule?.destination, '/api/index', source);
    assert.ok(vercel.rewrites.indexOf(rule!) < vercel.rewrites.length - 1);
  }
  const apiOnlyFiles = [PLAY_INTERNAL_OUTPUT_FILE];
  assert.equal(PLAY_INTERNAL_OUTPUT_BODY.includes('<'), false);
  assert.equal(/\.(html|js|css)$/i.test(PLAY_INTERNAL_OUTPUT_FILE), false);
  const denied = ['/', '/index.html', '/focus-sw.js', '/offline-shell.json', '/budget.json', '/assets/app.js', '/studio', '/admin', '/support', '/media/guide.mp3', `/${PLAY_INTERNAL_OUTPUT_FILE}`];
  for (const pathname of denied) {
    const response = resolveDeploymentRequest({ pathname, apiOnly: true, outputFiles: apiOnlyFiles, rewrites: vercel.rewrites });
    assert.deepEqual(response, { layer: 'middleware', status: 404, code: 'PLAY_INTERNAL_API_ONLY', contentType: 'application/json' }, pathname);
  }
  const asset = `/content-assets/${'ab'.repeat(32)}.png`;
  assert.deepEqual(resolveDeploymentRequest({ pathname: '/api/health', apiOnly: true, outputFiles: apiOnlyFiles, rewrites: vercel.rewrites }), { layer: 'rewrite', destination: '/api/index' });
  assert.deepEqual(resolveDeploymentRequest({ pathname: asset, apiOnly: true, outputFiles: apiOnlyFiles, rewrites: vercel.rewrites }), { layer: 'rewrite', destination: '/api/index' });
  assert.equal(resolveDeploymentRequest({ pathname: '/index.html', apiOnly: true, outputFiles: apiOnlyFiles, rewrites: vercel.rewrites, middleware: false }).layer, 'rewrite');
  assert.equal(resolveDeploymentRequest({ pathname: '/', apiOnly: true, outputFiles: apiOnlyFiles, rewrites: vercel.rewrites, middleware: false }).layer, 'platform-missing');
  const websiteFiles = ['index.html', 'focus-sw.js', 'offline-shell.json', 'budget.json', 'assets/app.js', 'media/guide.mp3'];
  const website = (pathname: string) => resolveDeploymentRequest({ pathname, apiOnly: false, outputFiles: websiteFiles, rewrites: vercel.rewrites });
  assert.deepEqual(website('/'), { layer: 'filesystem', file: 'index.html' });
  assert.deepEqual(website('/index.html'), { layer: 'filesystem', file: 'index.html' });
  assert.deepEqual(website('/focus-sw.js'), { layer: 'filesystem', file: 'focus-sw.js' });
  assert.deepEqual(website('/assets/app.js'), { layer: 'filesystem', file: 'assets/app.js' });
  assert.deepEqual(website('/parent'), { layer: 'rewrite', destination: '/index.html' });
  assert.deepEqual(website('/studio'), { layer: 'rewrite', destination: '/index.html' });
  assert.deepEqual(website('/api/health'), { layer: 'rewrite', destination: '/api/index' });
});

test('compiled middleware runs without the TypeScript package path', async () => {
  const source = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
  const typescript = createRequire(import.meta.url)('typescript') as {
    transpileModule(input: string, options: { compilerOptions: { module: number; target: number }; fileName: string }): { outputText: string };
    ModuleKind: { ESNext: number };
    ScriptTarget: { ES2022: number };
  };
  const compiled = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
    fileName: 'middleware.ts',
  }).outputText;
  assert.doesNotMatch(compiled, /play-internal-android\.ts|\.ts['"]/);
  assert.doesNotMatch(compiled, /from ['"]\./);
  assert.match(compiled, /from '@vercel\/functions'/);
  const directory = await mkdtemp(join(tmpdir(), 'focus-middleware-'));
  const previous = {
    enabled: process.env.FOCUS_PLAY_INTERNAL_API,
    environment: process.env.VERCEL_ENV,
  };
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    await mkdir(join(directory, 'node_modules', '@vercel', 'functions'), { recursive: true });
    await writeFile(join(directory, 'node_modules', '@vercel', 'functions', 'package.json'), '{"type":"module","exports":"./index.js"}\n');
    await writeFile(join(directory, 'node_modules', '@vercel', 'functions', 'index.js'), 'export function next(options){ return { type: "next", headers: options?.headers ?? null }; }\n');
    await writeFile(join(directory, 'middleware.js'), compiled);
    const loaded = await import(pathToFileURL(join(directory, 'middleware.js')).href) as {
      playInternalEdgeDecision(input: { enabled: string | undefined; environment: string | undefined; pathname: string }): { action: string; apiOnly: boolean; code?: string };
      default(request: Request): Promise<Response | { type: string; headers: Record<string, string> | null }>;
    };
    const paths = ['/', '/index.html', '/focus-sw.js', '/studio', '/admin', '/support', '/media/guide.mp3', '/api/health', '/api/ready', '/api/me', '/api/studio', '/api/admin', '/api/support', `/content-assets/${'ab'.repeat(32)}.png`, `/content-assets/${'cd'.repeat(32)}.mp3`, '/content-assets/short.png', `/${PLAY_INTERNAL_OUTPUT_FILE}`];
    for (const environment of ['preview', 'production', undefined]) {
      for (const enabled of ['1', undefined]) {
        for (const pathname of paths) {
          assert.deepEqual(
            loaded.playInternalEdgeDecision({ enabled, environment, pathname }),
            playInternalEdgeDecision({ enabled, environment, pathname }),
            `${enabled ?? 'unset'}:${environment ?? 'unset'}:${pathname}`,
          );
        }
      }
    }
    process.env.FOCUS_PLAY_INTERNAL_API = '1';
    process.env.VERCEL_ENV = 'preview';
    const denied = await loaded.default(new Request('https://preview.example/'));
    assert(denied instanceof Response);
    assert.equal(denied.status, 404);
    assert.match(denied.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(await denied.text(), '{"code":"PLAY_INTERNAL_API_ONLY"}');
    const health = await loaded.default(new Request('https://preview.example/api/health'));
    const ready = await loaded.default(new Request('https://preview.example/api/ready'));
    assert.equal(health instanceof Response, false);
    assert.equal(ready instanceof Response, false);
    assert.deepEqual(health, { type: 'next', headers: { 'x-robots-tag': 'noindex' } });
    assert.deepEqual(ready, { type: 'next', headers: { 'x-robots-tag': 'noindex' } });
    delete process.env.FOCUS_PLAY_INTERNAL_API;
    const website = await loaded.default(new Request('https://preview.example/'));
    assert.equal(website instanceof Response, false);
    assert.deepEqual(website, { type: 'next', headers: null });
  } finally {
    if (previous.enabled === undefined) delete process.env.FOCUS_PLAY_INTERNAL_API;
    else process.env.FOCUS_PLAY_INTERNAL_API = previous.enabled;
    if (previous.environment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous.environment;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Play internal artifact policy rejects the debug certificate, cleartext, localhost and the old version code', () => {
  const sha = 'cd'.repeat(32);
  assert.throws(() => assertPlayInternalSigner('CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US', sha, sha), /PLAY_INTERNAL_DEBUG_SIGNER_REJECTED/);
  assert.throws(() => assertPlayInternalSigner('CN=Focus Island Upload, O=Focus Island', sha, 'ab'.repeat(32)), /PLAY_INTERNAL_CERT_MISMATCH/);
  assert.doesNotThrow(() => assertPlayInternalSigner('CN=Focus Island Upload, O=Focus Island', sha, sha));
  const origin = 'https://family.example.test';
  const bundle = Buffer.from(`preview ${origin} ${HOSTED_TEST_SERVICE_MARKER} local-development guardian-verification-required You decide whether to begin Not taking part now`);
  assert.doesNotThrow(() => assertPlayInternalBundle(bundle, origin));
  assert.throws(() => assertPlayInternalBundle(Buffer.concat([bundle, Buffer.from(' http://localhost:4181')]), origin), /PLAY_INTERNAL_LOCALHOST_PACKAGED/);
  assert.throws(() => assertPlayInternalManifest({ debuggable: false, allowBackup: 'false', usesCleartextTraffic: 'true', versionCode: 18, targetSdkVersion: 36 }), /PLAY_INTERNAL_CLEARTEXT_ENABLED/);
  assert.throws(() => assertPlayInternalManifest({ debuggable: false, allowBackup: 'false', usesCleartextTraffic: 'false', versionCode: 17, targetSdkVersion: 36 }), /PLAY_INTERNAL_VERSION_CODE_TOO_LOW/);
  assert.doesNotThrow(() => assertPlayInternalManifest({ debuggable: false, allowBackup: 'false', usesCleartextTraffic: 'false', versionCode: PLAY_INTERNAL_MIN_VERSION_CODE, targetSdkVersion: 36 }));
  const packaged = Buffer.from(`before ${password} after`);
  assert.throws(() => assertSecretsNotPackaged(packaged, [password]), /PLAY_INTERNAL_SECRET_PACKAGED/);
  try { assertSecretsNotPackaged(packaged, [password]); } catch (error) { assert.equal(error instanceof Error && error.message.includes(password), false); }
  assert.doesNotThrow(() => assertSecretsNotPackaged(Buffer.from('unsigned local bundle'), [password]));
});

test('hosted preview copy tells adults that records leave the device and local copy stays local', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    const hosted = [
      mobileCreateAcknowledgement(locale, true), mobilePreviewStatus(locale, true), mobileProfileAcknowledgement(locale, true),
      mobileAgeReviewAcknowledgement(locale, true), mobileHostedServiceNotice(locale),
    ].join('\n');
    assert.doesNotMatch(hosted, /local testing|saved locally|本地测试记录|保存在这台设备/);
    assert.equal(mobileCreateAcknowledgement(locale, false).includes(HOSTED_TEST_SERVICE_MARKER), false);
    assert.match(mobilePreviewStatus(locale, false), locale === 'en' ? /Local development preview/ : /本地开发预览/);
  }
  assert.match(mobileHostedServiceNotice('en'), /designated test family service/);
  assert.match(mobileCreateAcknowledgement('en', false), /local testing/);
});

test('the mobile shell version is above the rejected Play candidate and local verification still requires the debug certificate', async () => {
  const identity = JSON.parse(await readFile(new URL('../../apps/family-mobile/build-identity.json', import.meta.url), 'utf8'));
  const mobile = JSON.parse(await readFile(new URL('../../apps/family-mobile/package.json', import.meta.url), 'utf8'));
  assert.equal(mobile.version, '0.2.18');
  assert.equal(identity.androidVersionCode, 19);
  assert.ok(identity.androidVersionCode >= PLAY_INTERNAL_MIN_VERSION_CODE);
  const localVerifier = await readFile(new URL('../../scripts/verify-android-aab.mjs', import.meta.url), 'utf8');
  assert.match(localVerifier, /CN=Android Debug/);
  assert.match(localVerifier, /storeRelease: false/);
  assert.match(localVerifier, /usesCleartextTraffic === 'true'/);
});
