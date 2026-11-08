import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playInternalLocalBuildInputs } from '../packages/mobile-release/play-internal-android.ts';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const checkOnly = process.argv[2] === '--check' && process.argv.length === 3;

function run(command, args, cwd) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${command} exited ${code}`)));
  });
}

try {
  if (!checkOnly && process.argv.length !== 2) throw new Error('UNEXPECTED_ARGUMENT');
  const inputs = playInternalLocalBuildInputs(process.env);
  const requested = resolve(inputs.storeFile);
  if (!isAbsolute(requested)) throw new Error('PLAY_INTERNAL_KEYSTORE_PATH_INVALID');
  const requestedInfo = await lstat(requested);
  if (requestedInfo.isSymbolicLink()) throw new Error('PLAY_INTERNAL_KEYSTORE_PATH_INVALID');
  const storeFile = await realpath(requested);
  if (storeFile === root || storeFile.startsWith(root + sep)) throw new Error('PLAY_INTERNAL_KEYSTORE_PATH_INVALID');
  const info = await lstat(storeFile);
  if (!info.isFile() || info.isSymbolicLink() || !storeFile.endsWith('.p12') || info.size < 16 || info.size > 262144) throw new Error('PLAY_INTERNAL_KEYSTORE_PATH_INVALID');
  if ((info.mode & 0o077) !== 0) throw new Error('PLAY_INTERNAL_KEYSTORE_FILE_EXPOSED');
  const sdkPresent = Boolean(process.env.JAVA_HOME && process.env.ANDROID_HOME);
  console.log(JSON.stringify({
    ok: true, stage: checkOnly ? 'inputs' : 'build', uploadable: false, sdkPresent,
    origin: inputs.origin, certificateSha256: inputs.certificateSha256, alias: 'focus-island-upload',
  }));
  if (checkOnly) process.exit(0);
  if (!sdkPresent) throw new Error('PLAY_INTERNAL_ANDROID_SDK_REQUIRED');
  const output = resolve(root, 'dist/mobile-native/android-play-internal');
  await run(process.execPath, ['scripts/check-play-internal-api.mjs', '--output', `${output}/api-health.json`], root);
  await run(process.execPath, ['scripts/snapshot-mobile-source.mjs', `${output}/source-snapshot.json`], root);
  await run(process.execPath, ['scripts/mobile.mjs', 'prebuild', '--platform', 'android', '--clean', '--no-install'], root);
  await run(process.execPath, ['scripts/configure-android-play-internal.mjs', '--gradle', 'apps/family-mobile/android/app/build.gradle'], root);
  await run('bash', ['./gradlew', ':app:assembleRelease', ':app:bundleRelease', '--no-daemon', '--max-workers=2'], resolve(root, 'apps/family-mobile/android'));
  await run('bash', ['-lc', `
    set -euo pipefail
    ANDROID_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
    test -x "$ANDROID_TOOLS/aapt2" && test -x "$ANDROID_TOOLS/apksigner"
    mkdir -p dist/mobile-native/android-play-internal
    cp apps/family-mobile/android/app/build/outputs/bundle/release/app-release.aab dist/mobile-native/android-play-internal/FocusIsland-play-internal.aab
    cp apps/family-mobile/android/app/build/outputs/apk/release/app-release.apk dist/mobile-native/android-play-internal/FocusIsland-play-internal.apk
    CERT="$(node --input-type=module -e "import { PLAY_INTERNAL_UPLOAD_CERT_SHA256 } from './packages/mobile-release/play-internal-android.ts'; process.stdout.write(PLAY_INTERNAL_UPLOAD_CERT_SHA256)")"
    node scripts/verify-android-play-internal.mjs \
      --aab dist/mobile-native/android-play-internal/FocusIsland-play-internal.aab \
      --apk dist/mobile-native/android-play-internal/FocusIsland-play-internal.apk \
      --snapshot dist/mobile-native/android-play-internal/source-snapshot.json \
      --api-health dist/mobile-native/android-play-internal/api-health.json \
      --api-origin "$EXPO_PUBLIC_FOCUS_API_ORIGIN" \
      --expected-cert-sha256 "$CERT" \
      --source-ref "$(git rev-parse HEAD)" --java-home "$JAVA_HOME" --android-tools "$ANDROID_TOOLS" \
      --output dist/mobile-native/android-play-internal/play-internal-report.json
  `], root);
  console.log(JSON.stringify({ ok: true, stage: 'verified', uploadable: true, origin: inputs.origin }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'PLAY_INTERNAL_LOCAL_BUILD_FAILED';
  const secrets = [process.env.FOCUS_PLAY_UPLOAD_STORE_PASSWORD, process.env.FOCUS_PLAY_UPLOAD_KEY_PASSWORD].filter(value => value && value.length >= 4);
  const leaked = secrets.some(value => message.includes(value)) || message.includes('PRIVATE KEY') || message.includes('BEGIN ');
  console.error(leaked ? 'PLAY_INTERNAL_LOCAL_BUILD_FAILED' : message.split('\n')[0].slice(0, 300));
  process.exitCode = 1;
}
