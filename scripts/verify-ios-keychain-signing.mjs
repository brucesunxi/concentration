import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { assessIosKeychainSigning } from '../packages/mobile-release/ios-signing.ts';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--app' || !args[1].endsWith('.app')) {
  console.error('Usage: node scripts/verify-ios-keychain-signing.mjs --app /path/to/FocusIsland.app');
  process.exit(2);
}
if (process.platform !== 'darwin') {
  console.error('IOS_SIGNING_CHECK_REQUIRES_MACOS');
  process.exit(2);
}
const app = resolve(args[1]);
function run(command, parameters, input) {
  const result = spawnSync(command, parameters, { encoding: 'utf8', input, maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function plistJson(pathOrStdin, input) {
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', pathOrStdin], input);
  if (result.status !== 0) throw new Error('INVALID_IOS_PLIST');
  return JSON.parse(result.stdout);
}
try {
  const info = plistJson(join(app, 'Info.plist'));
  const signature = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const details = run('/usr/bin/codesign', ['-dv', '--verbose=2', app]);
  const teamIdentifier = (details.stdout + details.stderr).match(/^TeamIdentifier=(.+)$/m)?.[1] ?? null;
  const entitlementResult = run('/usr/bin/codesign', ['-d', '--entitlements', ':-', app]);
  const xml = entitlementResult.stdout.includes('<plist') ? entitlementResult.stdout : entitlementResult.stderr;
  const entitlements = entitlementResult.status === 0 && xml.includes('<plist') ? plistJson('-', xml) : {};
  const failures = assessIosKeychainSigning({
    bundleId: info.CFBundleIdentifier,
    expectedBundleId: 'dev.focusisland.family',
    teamIdentifier,
    supportedPlatforms: info.CFBundleSupportedPlatforms ?? [],
    entitlements,
    signatureValid: signature.status === 0,
  });
  console.log(JSON.stringify({ bundleId: info.CFBundleIdentifier, platform: info.CFBundleSupportedPlatforms, teamIdentifier, keychainSigningReady: failures.length === 0, failures }));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
