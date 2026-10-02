import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This verifies local development artifacts. It does not certify runtime behavior,
// the compiler, content effectiveness, or eligibility for a store release.
async function main() {
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = new Map();
const supported = new Set(['--ios', '--android', '--android-tools', '--snapshot', '--output']);
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  assert(supported.has(name) && value && !value.startsWith('--') && !args.has(name), 'Invalid or duplicate argument');
  args.set(name, resolve(value));
}
assert(args.size === supported.size, 'Required: --ios APP --android APK --android-tools BUILD_TOOLS --snapshot JSON --output JSON');
const sha = value => createHash('sha256').update(value).digest('hex');
const run = (tool, parameters) => execFileSync(tool, parameters, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const source = JSON.parse(await readFile(args.get('--snapshot'), 'utf8'));
assert(source.schemaVersion === 1 && Array.isArray(source.sourceFiles) && source.sourceFiles.length > 0, 'Invalid source snapshot');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
assert(source.sourceVersion === version, 'Snapshot is not for the current source version');
const buildRoot = await realpath(source.buildDirectory);
assert(buildRoot !== root, 'Build source must be isolated');
const unique = new Set();
for (const entry of source.sourceFiles) {
  assert(typeof entry.path === 'string' && !isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..'), 'Unsafe source path');
  assert(!unique.has(entry.path), 'Repeated source path'); unique.add(entry.path);
  for (const directory of [root, buildRoot]) {
    const file = await realpath(join(directory, entry.path));
    assert(file.startsWith(directory + sep), 'Source escaped its directory');
    const bytes = await readFile(file);
    assert(bytes.length === entry.bytes && sha(bytes) === entry.sha256, `Source changed since snapshot: ${entry.path}`);
  }
}
for (const required of ['package.json', 'package-lock.json', 'apps/family-mobile/src/App.tsx', 'apps/family-mobile/app.config.ts', 'apps/family-mobile/build-identity.json']) assert(unique.has(required), `Incomplete source snapshot: ${required}`);
const buildIdentity = JSON.parse(await readFile(join(root, 'apps/family-mobile/build-identity.json'), 'utf8'));
assert(Number.isSafeInteger(buildIdentity.androidVersionCode) && buildIdentity.androidVersionCode > 0, 'Invalid Android version code');
assert(typeof buildIdentity.iosBuildNumber === 'string' && /^[1-9]\d*$/.test(buildIdentity.iosBuildNumber), 'Invalid iOS build number');

const forbiddenFile = name => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.focus-data|.*\.jwk\.json|.*\.sqlite(?:-wal|-shm)?|.*\.db)(?:\/|$)/.test(name);
async function inventory(directory, prefix = '') {
  const files = [];
  for (const name of (await readdir(join(directory, prefix))).sort()) {
    const entry = join(prefix, name), file = join(directory, entry), stat = await lstat(file);
    assert(!stat.isSymbolicLink(), `Unexpected link in app: ${entry}`);
    assert(!forbiddenFile(entry), `Private-data filename found in app: ${entry}`);
    if (stat.isDirectory()) files.push(...await inventory(directory, entry));
    else { const body = await readFile(file); files.push({ path: entry, bytes: body.length, sha256: sha(body) }); }
  }
  return files;
}
const ios = args.get('--ios'), apk = args.get('--android'), tools = args.get('--android-tools');
const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(ios, 'Info.plist')]));
assert(info.CFBundleIdentifier === 'dev.focusisland.family', 'Unexpected iOS application');
assert(info.CFBundleShortVersionString === source.appVersion, 'Wrong iOS app version');
assert(info.CFBundleVersion === buildIdentity.iosBuildNumber, 'Wrong iOS build number');
assert(info.CFBundleSupportedPlatforms?.includes('iPhoneSimulator'), 'Expected an iOS simulator build');
assert(info.NSAppTransportSecurity?.NSAllowsLocalNetworking === true, 'Local API access missing');
for (const permission of ['NSMicrophoneUsageDescription', 'NSCameraUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysUsageDescription']) assert(!info[permission], `Unexpected iOS permission: ${permission}`);
const iosFiles = await inventory(ios);
const executable = join(ios, info.CFBundleExecutable);
const architectures = run('/usr/bin/lipo', ['-archs', executable]).trim().split(/\s+/);
assert(architectures.includes('arm64'), 'Missing arm64 simulator executable');
const entitlementRead = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', ios], { encoding: 'utf8' });
const entitlementText = entitlementRead.stdout + entitlementRead.stderr;
const keychainEntitlementPresent = entitlementRead.status === 0
  && /<key>keychain-access-groups<\/key>/.test(entitlementText)
  && /<key>application-identifier<\/key>/.test(entitlementText)
  && entitlementText.includes('dev.focusisland.family')
  && !entitlementText.includes('$(AppIdentifierPrefix)');
const iosBundle = await readFile(join(ios, 'main.jsbundle'));

const apkFiles = run('/usr/bin/unzip', ['-Z1', apk]).trim().split('\n');
assert(!apkFiles.some(forbiddenFile), 'Private-data filename found in APK');
const badging = run(join(tools, 'aapt2'), ['dump', 'badging', apk]);
const xml = run(join(tools, 'aapt2'), ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml']);
assert(badging.includes("package: name='dev.focusisland.family'"), 'Unexpected Android application');
assert(badging.includes(`versionName='${source.appVersion}'`), 'Wrong Android app version');
assert(badging.includes(`versionCode='${buildIdentity.androidVersionCode}'`), 'Wrong Android version code');
assert(!badging.includes('application-debuggable'), 'Expected a bundled Release build');
assert(/android:allowBackup[^\n]*=false\b/.test(xml), 'Android backup must be disabled');
assert(/android:usesCleartextTraffic[^\n]*=true\b/.test(xml), 'Expected explicit local networking configuration');
const permissions = [...badging.matchAll(/^uses-permission: name='([^']+)'/gm)].map(m => m[1]);
for (const permission of ['RECORD_AUDIO', 'CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) assert(!permissions.includes('android.permission.' + permission), `Unexpected Android permission: ${permission}`);
const signature = run(join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
const certificateSha256 = signature.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/)?.[1];
assert(certificateSha256, 'Missing verified signing certificate');
const androidBundle = execFileSync('/usr/bin/unzip', ['-p', apk, 'assets/index.android.bundle'], { maxBuffer: 32 * 1024 * 1024 });
const markers = ['http://localhost:4181', 'family-content-1', 'parent-guide-2-preview', 'FAMILY_CONTENT_CHANGED', 'OFFLINE_JOURNAL_CHANGED', 'family-history-1', 'observationsCursor', 'sessionsCursor', 'life-history-1', 'LIFE_HISTORY_PAGE_FAILED', 'AUDIO_COVERAGE_REQUIRED', 'Audio could not play. You can read the instruction and continue.'];
for (const marker of markers) for (const [platform, body] of [['ios', iosBundle], ['android', androidBundle]]) assert(body.includes(Buffer.from(marker)), `Missing ${platform} bundle marker: ${marker}`);
const summary = body => ({ bytes: body.length, sha256: sha(body) });
const report = {
  schemaVersion: 1, recordedAt: new Date().toISOString(), sourceVersion: version, appVersion: source.appVersion,
  mode: 'local-development', requiresMetro: false, storeRelease: false,
  sourceSnapshot: { path: relative(root, args.get('--snapshot')), sha256: sha(await readFile(args.get('--snapshot'))), checkedFiles: unique.size },
  ios: { path: relative(root, ios), platform: 'iPhoneSimulator', architectures, sdk: info.DTSDKName, applicationId: info.CFBundleIdentifier, buildNumber: info.CFBundleVersion, keychainEntitlementPresent, embeddedBundle: summary(iosBundle), files: iosFiles },
  android: { path: relative(root, apk), ...summary(await readFile(apk)), applicationId: 'dev.focusisland.family', abis: [...new Set(apkFiles.map(p => p.match(/^lib\/([^/]+)\//)?.[1]).filter(Boolean))], permissions, allowBackup: false, usesCleartextTraffic: true, signatureVerified: true, certificateSha256, embeddedBundle: summary(androidBundle) },
  embeddedMarkers: markers,
  deviceVerification: { performedByThisVerifier: false, uiVerified: false, runtimeEncryptionVerified: false, offlineColdStartVerified: false },
  limitations: ['Simulator and arm64 local test artifacts only', ...(keychainEntitlementPresent ? [] : ['iOS simulator signature lacks a Keychain entitlement; secure storage may fail on some simulator states, so every target device needs a runtime check']), 'Filename checks do not certify absence of all possible secrets', 'Source and bundle markers do not attest a trusted compiler', 'No complete runtime, real-device, store or effectiveness approval']
};
await writeFile(args.get('--output'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceVersion: version, appVersion: source.appVersion, sourceFiles: unique.size, iosFiles: iosFiles.length, androidSignatureVerified: true, output: args.get('--output') }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
