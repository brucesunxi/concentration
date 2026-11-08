import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyPlayInternalReleaseSigning } from '../../packages/mobile-release/android-play-signing.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

const before = `apply plugin: "com.android.application"
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
`;

test('Play internal signing replaces only the release debug certificate and keeps secrets out of Gradle', () => {
  const patched = applyPlayInternalReleaseSigning(before);
  assert.equal(patched.split('signingConfig signingConfigs.debug').length, 2);
  assert.match(patched, /signingConfig signingConfigs\.playInternal/);
  assert.match(patched, /throw new GradleException\('PLAY_INTERNAL_SIGNING_CONFIG_MISSING'\)/);
  assert.doesNotMatch(patched, /storePassword ['"](?!android')/);
  assert.match(patched, /minifyEnabled enableMinifyInReleaseBuilds/);
  assert.equal(applyPlayInternalReleaseSigning(patched), patched);
  assert.throws(() => applyPlayInternalReleaseSigning(before.replace('Caution!', 'Careful!')), /PLAY_INTERNAL_GRADLE_TEMPLATE_UNEXPECTED/);
});

test('Play internal command checks fail closed without printing a sentinel secret', async () => {
  const password = 'sentinel-play-password-not-a-real-secret';
  const prerequisite = spawnSync(process.execPath, ['scripts/check-play-internal-prerequisites.mjs'], {
    cwd: root, encoding: 'utf8',
    env: {
      PATH: process.env.PATH, FOCUS_ANDROID_DISTRIBUTION: 'play-internal',
      EXPO_PUBLIC_FOCUS_API_ORIGIN: 'https://family.example.test',
      FOCUS_PLAY_UPLOAD_STORE_PASSWORD: password,
      FOCUS_PLAY_UPLOAD_KEY_ALIAS: 'focus-island-upload',
      FOCUS_PLAY_UPLOAD_KEY_PASSWORD: password,
    },
  });
  assert.equal(prerequisite.status, 1);
  assert.match(prerequisite.stderr, /FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64/);
  assert.equal(`${prerequisite.stdout}${prerequisite.stderr}`.includes(password), false);

  const unreachable = spawnSync(process.execPath, ['scripts/check-play-internal-api.mjs', '--output', 'dist/not-written.json'], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, EXPO_PUBLIC_FOCUS_API_ORIGIN: 'http://localhost:4181' },
  });
  assert.equal(unreachable.status, 1);
  assert.match(unreachable.stderr, /PLAY_INTERNAL_HTTPS_API_REQUIRED/);

  const protectedPreview = spawnSync(process.execPath, ['scripts/check-play-internal-api.mjs', '--output', 'dist/not-written.json'], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, EXPO_PUBLIC_FOCUS_API_ORIGIN: 'https://concentration-two.vercel.app' },
  });
  assert.equal(protectedPreview.status, 1);
  assert.match(protectedPreview.stderr, /PLAY_INTERNAL_PROTECTED_PREVIEW_FORBIDDEN/);

  const directory = await mkdtemp(join(tmpdir(), 'focus-play-keystore-'));
  try {
    const output = join(directory, 'upload.p12');
    const payload = Buffer.from('not-a-real-upload-key-material');
    const created = spawnSync(process.execPath, ['scripts/materialize-play-upload-keystore.mjs', '--output', output], {
      cwd: root, encoding: 'utf8',
      env: { PATH: process.env.PATH, FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64: payload.toString('base64') },
    });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stdout.includes(payload.toString('base64')), false);
    assert.deepEqual(await readFile(output), payload);
    assert.equal((await stat(output)).mode & 0o077, 0);
    const localCheck = spawnSync(process.execPath, ['scripts/build-play-internal-android.mjs', '--check'], {
      cwd: root, encoding: 'utf8',
      env: {
        PATH: process.env.PATH, FOCUS_ANDROID_DISTRIBUTION: 'play-internal',
        EXPO_PUBLIC_FOCUS_API_ORIGIN: 'https://family.example.test',
        FOCUS_UPLOAD_STORE_FILE: output, FOCUS_PLAY_UPLOAD_KEY_ALIAS: 'focus-island-upload',
        FOCUS_PLAY_UPLOAD_STORE_PASSWORD: password, FOCUS_PLAY_UPLOAD_KEY_PASSWORD: password,
      },
    });
    assert.equal(localCheck.status, 0, localCheck.stderr);
    const localReport = JSON.parse(localCheck.stdout.trim());
    assert.equal(localReport.uploadable, false);
    assert.equal(localReport.stage, 'inputs');
    assert.equal(localCheck.stdout.includes(password), false);
    const protectedBuild = spawnSync(process.execPath, ['scripts/build-play-internal-android.mjs', '--check'], {
      cwd: root, encoding: 'utf8',
      env: {
        PATH: process.env.PATH, FOCUS_ANDROID_DISTRIBUTION: 'play-internal',
        EXPO_PUBLIC_FOCUS_API_ORIGIN: 'https://concentration-two.vercel.app',
        FOCUS_UPLOAD_STORE_FILE: output, FOCUS_PLAY_UPLOAD_KEY_ALIAS: 'focus-island-upload',
        FOCUS_PLAY_UPLOAD_STORE_PASSWORD: password, FOCUS_PLAY_UPLOAD_KEY_PASSWORD: password,
      },
    });
    assert.equal(protectedBuild.status, 1);
    assert.match(protectedBuild.stderr, /PLAY_INTERNAL_PROTECTED_PREVIEW_FORBIDDEN/);
    assert.equal(protectedBuild.stderr.includes(password), false);
    const insidePath = join(root, 'upload.p12');
    const inside = spawnSync(process.execPath, ['scripts/materialize-play-upload-keystore.mjs', '--output', insidePath], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64: payload.toString('base64') },
    });
    assert.equal(inside.status, 1);
    assert.match(inside.stderr, /PLAY_INTERNAL_KEYSTORE_PATH_INVALID/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(join(root, 'upload.p12'), { force: true });
  }
});
