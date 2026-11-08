import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAndroidBundleManifest } from '../packages/mobile-release/android-bundle-manifest.mjs';
import {
  PLAY_INTERNAL_APP_NAME,
  assertPlayInternalBundle,
  assertPlayInternalHealthReport,
  assertPlayInternalManifest,
  assertPlayInternalSigner,
  assertSecretsNotPackaged,
  bundleHasText,
  playInternalApiOrigin,
  playInternalCertificateSha256,
} from '../packages/mobile-release/play-internal-android.ts';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const options = new Map();
const allowed = new Set(['--aab', '--apk', '--snapshot', '--java-home', '--android-tools', '--output', '--source-ref', '--api-origin', '--api-health', '--expected-cert-sha256']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (program, args, binary = false) => execFileSync(program, args, { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 40 * 1024 * 1024 });
const pathOptions = new Set(['--aab', '--apk', '--snapshot', '--java-home', '--android-tools', '--output', '--api-health']);

function signingCertificate(output) {
  const pem = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  assert(pem, 'APK signing certificate is unavailable');
  return new X509Certificate(pem);
}

async function main() {
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index], value = process.argv[index + 1];
    assert(allowed.has(name) && value && !value.startsWith('--') && !options.has(name), 'Invalid or duplicate argument');
    options.set(name, pathOptions.has(name) ? resolve(value) : value);
  }
  for (const name of ['--aab', '--snapshot', '--java-home', '--output', '--source-ref', '--api-origin', '--api-health', '--expected-cert-sha256']) assert(options.has(name), `Missing ${name}`);
  assert(options.has('--apk') === options.has('--android-tools'), 'APK verification needs both --apk and --android-tools');
  const aab = await realpath(options.get('--aab'));
  const snapshotPath = await realpath(options.get('--snapshot'));
  const healthPath = await realpath(options.get('--api-health'));
  const output = options.get('--output');
  assert([aab, snapshotPath, healthPath].every(path => path.startsWith(root + sep)), 'AAB, snapshot and health report must be in the workspace');
  assert(output.startsWith(root + sep) && (await realpath(dirname(output))).startsWith(root + sep), 'Report must be in the workspace');
  const origin = playInternalApiOrigin(options.get('--api-origin'));
  const expectedCertificateSha256 = playInternalCertificateSha256(options.get('--expected-cert-sha256'));
  const apiHealth = assertPlayInternalHealthReport(JSON.parse(await readFile(healthPath, 'utf8')), origin);

  const javaHome = await realpath(options.get('--java-home'));
  const snapshotBytes = await readFile(snapshotPath);
  const source = JSON.parse(snapshotBytes.toString('utf8'));
  assert(source.schemaVersion === 1 && source.includesFamilyData === false && Array.isArray(source.sourceFiles) && source.sourceFiles.length > 0, 'Invalid source snapshot');
  const sourceCommit = run('git', ['-C', root, 'rev-parse', '--verify', `${options.get('--source-ref')}^{commit}`]).trim();
  assert(/^[a-f0-9]{40}$/.test(sourceCommit), 'Source reference must resolve to a commit');
  const readSourceFile = async path => run('git', ['-C', root, 'show', `${sourceCommit}:${path}`], true);
  const paths = new Set();
  for (const entry of source.sourceFiles) {
    assert(typeof entry.path === 'string' && !isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..') && !entry.path.startsWith('-') && !paths.has(entry.path), 'Unsafe or duplicate source path');
    paths.add(entry.path);
    const bytes = await readSourceFile(entry.path);
    assert(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, `Source changed after snapshot: ${entry.path}`);
  }
  for (const required of [
    'package.json', 'package-lock.json', 'apps/family-mobile/package.json', 'apps/family-mobile/app.config.ts',
    'apps/family-mobile/build-identity.json', 'apps/family-mobile/src/App.tsx',
    'packages/mobile-release/play-internal-android.ts', 'packages/mobile-release/android-play-signing.mjs',
    'packages/session-runtime/mobile-preview-copy.ts', 'scripts/configure-android-play-internal.mjs',
    'scripts/verify-android-play-internal.mjs', 'scripts/check-play-internal-api.mjs',
  ]) assert(paths.has(required), `Incomplete source snapshot: ${required}`);
  const appVersion = JSON.parse((await readSourceFile('apps/family-mobile/package.json')).toString('utf8')).version;
  const sourceVersion = JSON.parse((await readSourceFile('package.json')).toString('utf8')).version;
  const identity = JSON.parse((await readSourceFile('apps/family-mobile/build-identity.json')).toString('utf8'));
  assert(source.sourceVersion === sourceVersion && source.appVersion === appVersion, 'Snapshot version differs from its source');
  assert(identity.androidVersionCode >= 18, 'Play internal version code must be above the rejected local build');

  run('/usr/bin/unzip', ['-tqq', aab]);
  const entries = run('/usr/bin/unzip', ['-Z1', aab]).trim().split('\n');
  assert(entries.length === new Set(entries).size, 'Duplicate AAB entries');
  for (const required of ['BundleConfig.pb', 'base/manifest/AndroidManifest.xml', 'base/assets/index.android.bundle']) assert(entries.includes(required), `AAB entry missing: ${required}`);
  assert(!entries.some(name => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.focus-data|.*\.jwk\.json|.*\.sqlite(?:-wal|-shm)?|.*\.db|.*\.(?:jks|keystore|p12))(?:\/|$)/.test(name)), 'Private-data filename found in AAB');
  const manifest = readAndroidBundleManifest(run('/usr/bin/unzip', ['-p', aab, 'base/manifest/AndroidManifest.xml'], true));
  assert(manifest.applicationId === 'dev.focusisland.family', 'Unexpected Android application ID');
  assert(manifest.versionName === appVersion && manifest.versionCode === identity.androidVersionCode, 'AAB version differs from source');
  assertPlayInternalManifest(manifest);
  for (const suffix of ['RECORD_AUDIO', 'CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) assert(!manifest.permissions.includes(`android.permission.${suffix}`), `Unexpected permission: ${suffix}`);
  const abis = [...new Set(entries.map(name => name.match(/^base\/lib\/([^/]+)\/libexpo-sqlite\.so$/)?.[1]).filter(Boolean))].sort();
  assert(JSON.stringify(abis) === JSON.stringify(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].sort()), 'AAB is missing native storage for an expected ABI');
  const bundle = run('/usr/bin/unzip', ['-p', aab, 'base/assets/index.android.bundle'], true);
  assertPlayInternalBundle(bundle, origin);
  const aabBytes = await readFile(aab);
  assert(bundleHasText(aabBytes, PLAY_INTERNAL_APP_NAME), 'Play internal app name was not packaged');
  assert(!bundleHasText(aabBytes, 'Focus Island Dev'), 'Local development app name is still packaged');
  const keystoreBase64 = process.env.FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64?.replace(/\s+/g, '');
  assertSecretsNotPackaged(aabBytes, [process.env.FOCUS_PLAY_UPLOAD_STORE_PASSWORD, process.env.FOCUS_PLAY_UPLOAD_KEY_PASSWORD, keystoreBase64]);
  if (keystoreBase64 && keystoreBase64.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(keystoreBase64)) {
    const keystoreBytes = Buffer.from(keystoreBase64, 'base64');
    if (keystoreBytes.length >= 16 && aabBytes.includes(keystoreBytes)) throw new Error('PLAY_INTERNAL_SECRET_PACKAGED');
  }

  const jarsigner = join(javaHome, 'bin/jarsigner'), keytool = join(javaHome, 'bin/keytool');
  const signature = run(jarsigner, ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', '-verbose', aab]);
  assert(/\bjar verified\./.test(signature), 'AAB signature did not verify');
  const certificate = run(keytool, ['-J-Duser.language=en', '-J-Duser.country=US', '-printcert', '-jarfile', aab]);
  const signer = certificate.match(/^Owner: (.+)$/m)?.[1] ?? '';
  const certificateSha256 = certificate.match(/^\s*SHA256: ([A-F0-9:]+)$/m)?.[1]?.replaceAll(':', '').toLowerCase() ?? '';
  assertPlayInternalSigner(signer, certificateSha256, expectedCertificateSha256);
  assert((certificate.match(/^Signer #\d+:/gm) ?? []).length === 1, 'Expected one AAB signer');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(aab)) digest.update(chunk);

  let apkReport;
  if (options.has('--apk')) {
    const apk = await realpath(options.get('--apk'));
    const androidTools = await realpath(options.get('--android-tools'));
    assert(apk.startsWith(root + sep), 'APK must be in the workspace');
    const badging = run(join(androidTools, 'aapt2'), ['dump', 'badging', apk]);
    const apkManifest = run(join(androidTools, 'aapt2'), ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml']);
    const apkSignature = run(join(androidTools, 'apksigner'), ['verify', '--verbose', '--print-certs-pem', apk]);
    assert(badging.includes("package: name='dev.focusisland.family'"), 'Wrong APK package');
    assert(badging.includes(`versionName='${appVersion}'`), 'Wrong APK version');
    assert(Number(badging.match(/\bversionCode='(\d+)'/)?.[1]) === identity.androidVersionCode, 'Wrong APK version code');
    assert(!badging.includes('application-debuggable') && !/android:debuggable[^\n]*=true\b/.test(apkManifest), 'Debuggable APK');
    assert(/android:allowBackup[^\n]*=false\b/.test(apkManifest), 'APK backup must be disabled');
    assert(/android:usesCleartextTraffic[^\n]*=false\b/.test(apkManifest), 'APK cleartext must be disabled');
    assert(apkSignature.includes('Verified using v2 scheme (APK Signature Scheme v2): true'), 'APK signature verification failed');
    const apkCertificate = signingCertificate(apkSignature);
    const apkCertificateSha256 = apkCertificate.fingerprint256.replaceAll(':', '').toLowerCase();
    assertPlayInternalSigner(apkCertificate.subject, apkCertificateSha256, expectedCertificateSha256);
    assert(apkCertificateSha256 === certificateSha256, 'APK and AAB certificates differ');
    const apkBundle = run('/usr/bin/unzip', ['-p', apk, 'assets/index.android.bundle'], true);
    assertPlayInternalBundle(apkBundle, origin);
    const apkBytes = await readFile(apk);
    assert(bundleHasText(apkBytes, PLAY_INTERNAL_APP_NAME) && !bundleHasText(apkBytes, 'Focus Island Dev'), 'Unexpected APK app name');
    assertSecretsNotPackaged(apkBytes, [process.env.FOCUS_PLAY_UPLOAD_STORE_PASSWORD, process.env.FOCUS_PLAY_UPLOAD_KEY_PASSWORD, keystoreBase64]);
    if (keystoreBase64 && keystoreBase64.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(keystoreBase64)) {
      const keystoreBytes = Buffer.from(keystoreBase64, 'base64');
      if (keystoreBytes.length >= 16 && apkBytes.includes(keystoreBytes)) throw new Error('PLAY_INTERNAL_SECRET_PACKAGED');
    }
    apkReport = { path: apk.slice(root.length + 1), bytes: apkBytes.length, sha256: sha256(apkBytes), certificateSha256: apkCertificateSha256, signatureVerified: true };
  }

  const report = {
    schemaVersion: 1,
    distribution: 'google-play-internal',
    mode: 'play-internal',
    storeRelease: false,
    productionRelease: false,
    internalTestingCandidate: true,
    sourceVersion, appVersion,
    apiOrigin: origin,
    apiHealth,
    embeddedServiceMode: 'local-development',
    aab: {
      path: aab.slice(root.length + 1), bytes: (await stat(aab)).size, sha256: digest.digest('hex'), manifest, abis,
      signatureVerified: true, signer, certificateSha256, embeddedBundle: { bytes: bundle.length, sha256: sha256(bundle) }, entries: entries.length,
    },
    ...(apkReport ? { apk: apkReport } : {}),
    sourceSnapshot: { path: snapshotPath.slice(root.length + 1), sha256: sha256(snapshotBytes), checkedFiles: paths.size, sourceCommit },
    limitations: [
      'Internal testing candidate only. Not a production release and not approved for real-family use.',
      'The client still requires the family service to answer in local-development mode. Production market gates stay closed.',
      'The upload certificate matches the configured public fingerprint. The private key is not part of this report.',
      'A passing health check is unauthenticated HTTP 200 from /api/health and /api/ready, with audience play-internal. It does not prove tester accounts, privacy-policy URLs, payments, content review, or a specific device.',
      'Static checks do not prove device behavior, Play Console submission, or data deletion outside this service.',
    ],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({
    aab: report.aab.path, sha256: report.aab.sha256, signatureVerified: true, storeRelease: false,
    distribution: report.distribution, versionCode: manifest.versionCode, apiOrigin: origin, output: output.slice(root.length + 1),
  }));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'PLAY_INTERNAL_VERIFY_FAILED';
  console.error(message.includes('PRIVATE KEY') || message.includes('BEGIN ') ? 'PLAY_INTERNAL_VERIFY_FAILED' : message);
  process.exitCode = 1;
});
