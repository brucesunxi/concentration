import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

assert(process.argv.length === 4, 'Expected the original and renewed APK reports');
const [original, checked] = await Promise.all(process.argv.slice(2).map(async path => JSON.parse(await readFile(path, 'utf8'))));
assert(original.sourceSnapshot?.sourceCommit === checked.sourceSnapshot?.sourceCommit, 'The downloaded APK source changed');
assert(original.apk?.sha256 === checked.apk?.sha256 && original.apk?.bytes === checked.apk?.bytes, 'The downloaded APK bytes changed');
assert(original.apk?.certificateSha256 === checked.apk?.certificateSha256, 'The downloaded APK signer changed');
assert(original.apk?.embeddedBundle?.sha256 === checked.apk?.embeddedBundle?.sha256, 'The downloaded native code changed');
assert(original.apk?.versionCode === checked.apk?.versionCode && original.appVersion === checked.appVersion, 'The downloaded app version changed');
console.log(JSON.stringify({ sourceCommit: checked.sourceSnapshot.sourceCommit, sha256: checked.apk.sha256, appVersion: checked.appVersion }));
