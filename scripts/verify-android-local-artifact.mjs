import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = new Map();
const names = new Set(['--apk', '--snapshot', '--android-tools', '--output', '--previous-apk', '--source-archive', '--source-archive-report', '--source-ref']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (program, argv, binary = false) => execFileSync(program, argv, { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 40 * 1024 * 1024 });

async function main() {
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i], value = process.argv[i + 1];
    assert(names.has(name) && value && !value.startsWith('--') && !args.has(name), 'Invalid or duplicate argument');
    args.set(name, name === '--source-ref' ? value : resolve(value));
  }
  for (const name of ['--apk', '--snapshot', '--android-tools', '--output']) assert(args.has(name), `Missing ${name}`);
  const apk = await realpath(args.get('--apk'));
  assert(apk.startsWith(root + sep), 'APK must be in the workspace');
  const output = args.get('--output');
  assert(output.startsWith(root + sep) && dirname(output).startsWith(root + sep), 'Output must be in the workspace');
  const source = JSON.parse(await readFile(args.get('--snapshot'), 'utf8'));
  assert(source.schemaVersion === 1 && Array.isArray(source.sourceFiles) && source.sourceFiles.length > 0, 'Invalid source snapshot');
  const archivedSource = args.has('--source-archive') || args.has('--source-archive-report');
  assert(args.has('--source-archive') === args.has('--source-archive-report'), 'Source archive and report must be provided together');
  assert(!archivedSource || !args.has('--source-ref'), 'Choose a source archive or source commit');
  const sourceCommit = args.has('--source-ref') ? run('git', ['-C', root, 'rev-parse', '--verify', `${args.get('--source-ref')}^{commit}`]).trim() : null;
  assert(!sourceCommit || /^[a-f0-9]{40}$/.test(sourceCommit), 'Source reference must resolve to a commit');
  const readSourceFile = path => sourceCommit ? run('git', ['-C', root, 'show', `${sourceCommit}:${path}`], true)
    : archivedSource ? run('/usr/bin/tar', ['-xOzf', args.get('--source-archive'), path], true)
    : readFile(join(root, path));
  const version = JSON.parse((await readSourceFile('package.json')).toString('utf8')).version;
  assert(source.sourceVersion === version, 'Snapshot does not match archived source version');
  const buildRoot = archivedSource || sourceCommit ? null : await realpath(source.buildDirectory);
  if (buildRoot) assert(buildRoot !== root, 'Build source is not isolated');
  let sourceArchive;
  if (archivedSource) {
    run(process.execPath, [join(root, 'scripts/verify-mobile-source-archive.mjs'), '--archive', args.get('--source-archive'), '--snapshot', args.get('--snapshot'), '--report', args.get('--source-archive-report')]);
    const archiveReport = JSON.parse(await readFile(args.get('--source-archive-report'), 'utf8'));
    sourceArchive = { path: relative(root, args.get('--source-archive')), sha256: archiveReport.archive.sha256, checkedFiles: archiveReport.snapshot.sourceFiles };
  }
  const unique = new Set();
  for (const entry of source.sourceFiles) {
    assert(typeof entry.path === 'string' && !isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..'), 'Unsafe source path');
    assert(!unique.has(entry.path), 'Duplicate source path'); unique.add(entry.path);
    for (const directory of buildRoot ? [root, buildRoot] : []) {
      const path = await realpath(join(directory, entry.path));
      assert(path.startsWith(directory + sep), 'Source escaped its directory');
      const bytes = await readFile(path);
      assert(bytes.length === entry.bytes && digest(bytes) === entry.sha256, `Source changed after snapshot: ${entry.path}`);
    }
    if (sourceCommit) {
      const bytes = await readSourceFile(entry.path);
      assert(bytes.length === entry.bytes && digest(bytes) === entry.sha256, `Source changed after snapshot: ${entry.path}`);
    }
  }
  for (const name of ['package.json', 'package-lock.json', 'apps/family-mobile/src/App.tsx', 'apps/family-mobile/src/Recovery.tsx', 'apps/family-mobile/app.config.ts', 'apps/family-mobile/build-identity.json']) assert(unique.has(name), `Missing source: ${name}`);

  const androidTools = await realpath(args.get('--android-tools'));
  const badging = run(join(androidTools, 'aapt2'), ['dump', 'badging', apk]);
  const manifest = run(join(androidTools, 'aapt2'), ['dump', 'xmltree', apk, '--file', 'AndroidManifest.xml']);
  const signature = run(join(androidTools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
  const entries = run('/usr/bin/unzip', ['-Z1', apk]).trim().split('\n');
  const bundle = run('/usr/bin/unzip', ['-p', apk, 'assets/index.android.bundle'], true);
  const expectedAppVersion = JSON.parse((await readSourceFile('apps/family-mobile/package.json')).toString('utf8')).version;
  const buildIdentity = JSON.parse((await readSourceFile('apps/family-mobile/build-identity.json')).toString('utf8'));
  assert(Number.isSafeInteger(buildIdentity.androidVersionCode) && buildIdentity.androidVersionCode > 0, 'Invalid Android version code');
  assert(typeof buildIdentity.iosBuildNumber === 'string' && /^[1-9]\d*$/.test(buildIdentity.iosBuildNumber), 'Invalid iOS build number');
  assert(source.appVersion === expectedAppVersion, 'App version differs from source snapshot');
  const versionCode = Number(badging.match(/\bversionCode='(\d+)'/)?.[1]);
  assert(badging.includes("package: name='dev.focusisland.family'"), 'Wrong package');
  assert(badging.includes(`versionName='${expectedAppVersion}'`), 'Wrong app version');
  assert(versionCode === buildIdentity.androidVersionCode, 'Wrong Android version code');
  assert(!badging.includes('application-debuggable') && !/android:debuggable[^\n]*=true\b/.test(manifest), 'Debuggable APK');
  assert(/android:allowBackup[^\n]*=false\b/.test(manifest), 'Backup must be disabled');
  assert(/android:usesCleartextTraffic[^\n]*=true\b/.test(manifest), 'Local networking mode is not explicit');
  const abis = [...new Set(entries.map(name => name.match(/^lib\/([^/]+)\/libexpo-sqlite\.so$/)?.[1]).filter(Boolean))].sort();
  const declaredAbis = [...(badging.match(/^native-code: (.+)$/m)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
  assert(abis.includes('arm64-v8a') && JSON.stringify(abis) === JSON.stringify(declaredAbis), 'Wrong native architecture');
  assert(entries.includes('assets/index.android.bundle'), 'Missing native app code');
  assert(!entries.some(name => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.focus-data|.*\.jwk\.json|.*\.sqlite(?:-wal|-shm)?|.*\.db)(?:\/|$)/.test(name)), 'Private-data filename found in APK');
  const permissions = [...badging.matchAll(/^uses-permission: name='([^']+)'/gm)].map(match => match[1]);
  for (const name of ['RECORD_AUDIO', 'CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) assert(!permissions.includes(`android.permission.${name}`), `Unexpected permission: ${name}`);
  assert(signature.includes('Verified using v2 scheme (APK Signature Scheme v2): true'), 'APK signature verification failed');
  const certificateSha256 = signature.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/)?.[1];
  assert(certificateSha256 && signature.includes('CN=Android Debug'), 'Expected local test certificate');
  let upgradeFrom;
  if (args.has('--previous-apk')) {
    const previousApk = await realpath(args.get('--previous-apk'));
    assert(previousApk.startsWith(root + sep) && previousApk !== apk, 'Previous APK must be a different workspace file');
    const previousBadging = run(join(androidTools, 'aapt2'), ['dump', 'badging', previousApk]);
    const previousVersionCode = Number(previousBadging.match(/\bversionCode='(\d+)'/)?.[1]);
    assert(previousBadging.includes("package: name='dev.focusisland.family'"), 'Previous APK package differs');
    assert(Number.isSafeInteger(previousVersionCode) && versionCode > previousVersionCode, 'Android version code must increase');
    const previousSignature = run(join(androidTools, 'apksigner'), ['verify', '--verbose', '--print-certs', previousApk]);
    const previousCertificateSha256 = previousSignature.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/)?.[1];
    assert(previousCertificateSha256 === certificateSha256, 'Android signing certificate changed; in-place upgrade would fail');
    upgradeFrom = { path: relative(root, previousApk), versionCode: previousVersionCode, certificateSha256: previousCertificateSha256 };
  }
  const markers = ['MARKET_SCOPE_CHANGED', 'registrationPlatform', 'focus.local.journal-key.v1', 'local-development',
    'guardian-verification-required', 'You decide whether to begin', 'Not taking part now', '你想试试吗？',
    'Understand my data boundaries', 'not saved by default'];
  const [major, minor] = version.split('.').map(Number);
  if (major > 0 || minor >= 42) markers.push('My strategy trail');
  if (major > 0 || minor >= 45) markers.push('Age band review');
  // Hermes stores some non-ASCII string literals as UTF-16LE in its bytecode.
  for (const marker of markers) assert(bundle.includes(Buffer.from(marker)) || bundle.includes(Buffer.from(marker, 'utf16le')), `Missing app code marker: ${marker}`);
  const bytes = await readFile(apk);
  const report = {
    schemaVersion: 1, sourceVersion: version, appVersion: expectedAppVersion, mode: 'local-development',
    apk: { path: relative(root, apk), bytes: bytes.length, sha256: digest(bytes), applicationId: 'dev.focusisland.family', versionCode, abis, signatureVerified: true, certificateSha256, permissions, allowBackup: false, usesCleartextTraffic: true, embeddedBundle: { bytes: bundle.length, sha256: digest(bundle) } },
    ...(upgradeFrom ? { upgradeFrom } : {}),
    sourceSnapshot: { path: args.get('--snapshot'), sha256: digest(await readFile(args.get('--snapshot'))), checkedFiles: unique.size,
      ...(sourceCommit ? { sourceCommit } : {}) },
    ...(sourceArchive ? { sourceArchive } : {}),
    embeddedMarkers: markers,
    deviceVerification: { installed: false, login: false, sqlCipherAtRest: false, audioPlayback: false, offlineRecovery: false },
    limitations: ['Debug-signed local test APK; not a store release', 'Requires a reachable local family API', 'Static checks do not prove runtime encryption, sound quality, device behavior or market approval'],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ sourceVersion: version, apk: report.apk.path, sha256: report.apk.sha256, bytes: report.apk.bytes, signatureVerified: true, output }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
