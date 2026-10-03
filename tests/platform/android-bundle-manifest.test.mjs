import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readAndroidBundleManifest } from '../../packages/mobile-release/android-bundle-manifest.mjs';

// Fixture: base/manifest/AndroidManifest.xml from the v0.46 local AAB.
test('reads the packaged Android bundle manifest and rejects truncated protobuf', async () => {
  const bytes = await readFile(new URL('../fixtures/android-base-manifest.pb', import.meta.url));
  const manifest = readAndroidBundleManifest(bytes);
  assert.equal(manifest.applicationId, 'dev.focusisland.family');
  assert.equal(manifest.versionName, '0.2.8');
  assert.equal(manifest.versionCode, 9);
  assert.equal(manifest.allowBackup, 'false');
  assert.equal(manifest.usesCleartextTraffic, 'true');
  assert.equal(manifest.debuggable, false);
  assert(manifest.permissions.includes('android.permission.INTERNET'));
  assert(!manifest.permissions.includes('android.permission.CAMERA'));
  assert.throws(() => readAndroidBundleManifest(bytes.subarray(0, bytes.length - 1)));
});
