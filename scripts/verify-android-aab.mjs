import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAndroidBundleManifest } from '../packages/mobile-release/android-bundle-manifest.mjs';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const options = new Map();
const allowed = new Set(['--aab', '--snapshot', '--java-home', '--output', '--source-ref']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (program, args, binary = false) => execFileSync(program, args, { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 40 * 1024 * 1024 });

async function main() {
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index], value = process.argv[index + 1];
    assert(allowed.has(name) && value && !value.startsWith('--') && !options.has(name), 'Invalid or duplicate argument');
    options.set(name, name === '--source-ref' ? value : resolve(value));
  }
  for (const name of ['--aab', '--snapshot', '--java-home', '--output']) assert(options.has(name), `Missing ${name}`);
  const aab = await realpath(options.get('--aab'));
  const snapshotPath = await realpath(options.get('--snapshot'));
  const output = options.get('--output');
  assert(aab.startsWith(root + sep) && snapshotPath.startsWith(root + sep), 'AAB and snapshot must be in the workspace');
  assert(output.startsWith(root + sep) && (await realpath(dirname(output))).startsWith(root + sep), 'Report must be in the workspace');
  const javaHome = await realpath(options.get('--java-home'));
  const snapshotBytes = await readFile(snapshotPath), source = JSON.parse(snapshotBytes.toString('utf8'));
  assert(source.schemaVersion === 1 && source.includesFamilyData === false && Array.isArray(source.sourceFiles) && source.sourceFiles.length > 0, 'Invalid source snapshot');
  const sourceCommit = options.has('--source-ref')
    ? run('git', ['-C', root, 'rev-parse', '--verify', `${options.get('--source-ref')}^{commit}`]).trim() : null;
  assert(!sourceCommit || /^[a-f0-9]{40}$/.test(sourceCommit), 'Source reference must resolve to a commit');
  const buildRoot = sourceCommit ? null : await realpath(source.buildDirectory);
  if (buildRoot) {
    assert(buildRoot !== root && !buildRoot.startsWith(root + sep), 'Build source must be isolated');
    assert((await readFile(join(buildRoot, '.focus-native-source.json'))).equals(snapshotBytes), 'Build snapshot differs from delivered snapshot');
  }
  const readSourceFile = async path => sourceCommit
    ? run('git', ['-C', root, 'show', `${sourceCommit}:${path}`], true)
    : readFile(join(buildRoot, path));
  const paths = new Set();
  for (const entry of source.sourceFiles) {
    assert(typeof entry.path === 'string' && !isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..') && !entry.path.startsWith('-') && !paths.has(entry.path), 'Unsafe or duplicate source path');
    paths.add(entry.path);
    if (buildRoot) {
      const path = await realpath(join(buildRoot, entry.path));
      assert(path.startsWith(buildRoot + sep) && (await lstat(path)).isFile(), `Source escaped build: ${entry.path}`);
    }
    const bytes = await readSourceFile(entry.path);
    assert(bytes.length === entry.bytes && sha256(bytes) === entry.sha256, `Source changed after snapshot: ${entry.path}`);
  }
  for (const required of ['package.json', 'package-lock.json', 'apps/family-mobile/package.json', 'apps/family-mobile/app.config.ts', 'apps/family-mobile/build-identity.json', 'apps/family-mobile/src/App.tsx']) assert(paths.has(required), `Incomplete source snapshot: ${required}`);
  const appVersion = JSON.parse((await readSourceFile('apps/family-mobile/package.json')).toString('utf8')).version;
  const sourceVersion = JSON.parse((await readSourceFile('package.json')).toString('utf8')).version;
  const identity = JSON.parse((await readSourceFile('apps/family-mobile/build-identity.json')).toString('utf8'));
  assert(source.sourceVersion === sourceVersion && source.appVersion === appVersion, 'Snapshot version differs from its source');
  assert(Number.isSafeInteger(identity.androidVersionCode) && identity.androidVersionCode > 0, 'Invalid source Android version code');

  run('/usr/bin/unzip', ['-tqq', aab]);
  const entries = run('/usr/bin/unzip', ['-Z1', aab]).trim().split('\n');
  assert(entries.length === new Set(entries).size, 'Duplicate AAB entries');
  for (const required of ['BundleConfig.pb', 'base/manifest/AndroidManifest.xml', 'base/assets/index.android.bundle']) assert(entries.includes(required), `AAB entry missing: ${required}`);
  assert(!entries.some(name => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.focus-data|.*\.jwk\.json|.*\.sqlite(?:-wal|-shm)?|.*\.db)(?:\/|$)/.test(name)), 'Private-data filename found in AAB');
  const manifest = readAndroidBundleManifest(run('/usr/bin/unzip', ['-p', aab, 'base/manifest/AndroidManifest.xml'], true));
  assert(manifest.applicationId === 'dev.focusisland.family', 'Unexpected Android application ID');
  assert(manifest.versionName === appVersion && manifest.versionCode === identity.androidVersionCode, 'AAB version differs from source');
  assert(!manifest.debuggable && manifest.allowBackup === 'false' && manifest.usesCleartextTraffic === 'true', 'Unexpected local Android security configuration');
  for (const suffix of ['RECORD_AUDIO', 'CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) assert(!manifest.permissions.includes(`android.permission.${suffix}`), `Unexpected permission: ${suffix}`);
  const abis = [...new Set(entries.map(name => name.match(/^base\/lib\/([^/]+)\/libexpo-sqlite\.so$/)?.[1]).filter(Boolean))].sort();
  assert(JSON.stringify(abis) === JSON.stringify(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].sort()), 'AAB is missing native storage for an expected ABI');
  const bundle = run('/usr/bin/unzip', ['-p', aab, 'base/assets/index.android.bundle'], true);
  const markers = ['MARKET_SCOPE_CHANGED', 'registrationPlatform', 'focus.local.journal-key.v1', 'local-development', 'guardian-verification-required', 'You decide whether to begin', 'Not taking part now', '你想试试吗？'];
  for (const marker of markers) assert(bundle.includes(Buffer.from(marker)) || bundle.includes(Buffer.from(marker, 'utf16le')), `Missing app code marker: ${marker}`);

  const jarsigner = join(javaHome, 'bin/jarsigner'), keytool = join(javaHome, 'bin/keytool');
  const signature = run(jarsigner, ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', '-verbose', aab]);
  assert(/\bjar verified\./.test(signature), 'AAB signature did not verify');
  const certificate = run(keytool, ['-J-Duser.language=en', '-J-Duser.country=US', '-printcert', '-jarfile', aab]);
  const signer = certificate.match(/^Owner: (.+)$/m)?.[1];
  const certificateSha256 = certificate.match(/^\s*SHA256: ([A-F0-9:]+)$/m)?.[1]?.replaceAll(':', '').toLowerCase();
  assert(signer?.includes('CN=Android Debug') && /^[a-f0-9]{64}$/.test(certificateSha256 ?? ''), 'Expected one identified local debug signer');
  assert((certificate.match(/^Signer #\d+:/gm) ?? []).length === 1, 'Expected one AAB signer');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(aab)) digest.update(chunk);
  const report = {
    schemaVersion: 1, mode: 'local-development', storeRelease: false,
    sourceVersion, appVersion,
    aab: { path: aab.slice(root.length + 1), bytes: (await stat(aab)).size, sha256: digest.digest('hex'), manifest, abis,
      signatureVerified: true, signer, certificateSha256, embeddedBundle: { bytes: bundle.length, sha256: sha256(bundle) }, entries: entries.length },
    sourceSnapshot: { path: snapshotPath.slice(root.length + 1), sha256: sha256(snapshotBytes), checkedFiles: paths.size,
      ...(sourceCommit ? { sourceCommit } : { buildDirectory: buildRoot }) },
    embeddedMarkers: markers,
    limitations: ['Debug-signed local AAB with local cleartext API; not a store upload',
      ...(sourceCommit ? [] : ['Build source is held in a temporary directory until separately archived']),
      'Static checks do not prove device behavior, content approval, runtime data protection or market eligibility'],
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ aab: report.aab.path, sha256: report.aab.sha256, signatureVerified: true, storeRelease: false, output }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
