import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
  assertPlayInternalSigner,
  assertSecretsNotPackaged,
  assessPlayInternalHealth,
  familyPreviewStatus,
  playInternalApiOrigin,
  playInternalCertificateSha256,
  playInternalPrerequisites,
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
  assert.throws(() => assertPlayInternalServiceSeparation({ enabled: '1', hosts: [PROTECTED_PREVIEW_HOST] }), /PLAY_INTERNAL_API_PROTECTED_HOST_FORBIDDEN/);
  assert.doesNotThrow(() => assertPlayInternalServiceSeparation({ enabled: undefined, hosts: [PROTECTED_PREVIEW_HOST] }));
  assert.doesNotThrow(() => assertPlayInternalServiceSeparation({ enabled: '1', hosts: ['focus-island-internal.vercel.app'] }));
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
  assert.equal(mobile.version, '0.2.17');
  assert.equal(identity.androidVersionCode, 18);
  assert.ok(identity.androidVersionCode >= PLAY_INTERNAL_MIN_VERSION_CODE);
  const localVerifier = await readFile(new URL('../../scripts/verify-android-aab.mjs', import.meta.url), 'utf8');
  assert.match(localVerifier, /CN=Android Debug/);
  assert.match(localVerifier, /storeRelease: false/);
  assert.match(localVerifier, /usesCleartextTraffic === 'true'/);
});
