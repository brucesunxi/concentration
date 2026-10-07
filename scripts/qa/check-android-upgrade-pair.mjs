import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (process.argv.length !== 4) {
  throw new Error('Usage: check-android-upgrade-pair.mjs <previous-report> <current-report>');
}

const [previous, current] = await Promise.all(process.argv.slice(2).map(async path => JSON.parse(await readFile(path, 'utf8'))));
for (const report of [previous, current]) {
  assert.equal(report.mode, 'local-development', 'Upgrade acceptance only permits local test packages');
  assert.equal(report.apk?.signatureVerified, true, 'APK signature must be verified');
  assert.match(report.apk?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(report.sourceSnapshot?.sourceCommit ?? '', /^[a-f0-9]{40}$/);
}
assert.equal(previous.apk.applicationId, current.apk.applicationId, 'Application ID changed');
assert.equal(previous.apk.certificateSha256, current.apk.certificateSha256, 'Signing identity changed');
assert(previous.apk.versionCode < current.apk.versionCode, 'Android version code must increase for an upgrade');
assert.notEqual(previous.apk.sha256, current.apk.sha256, 'Upgrade packages must differ');

process.stdout.write(JSON.stringify({
  applicationId: current.apk.applicationId,
  fromVersionCode: previous.apk.versionCode,
  toVersionCode: current.apk.versionCode,
  fromSourceCommit: previous.sourceSnapshot.sourceCommit,
  toSourceCommit: current.sourceSnapshot.sourceCommit,
  signingIdentityMatches: true,
}) + '\n');
