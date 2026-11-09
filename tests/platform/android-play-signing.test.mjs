import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { applyPlayInternalReleaseSigning } from '../../packages/mobile-release/android-play-signing.mjs';
import { assertPlayInternalAppLabel, readArchiveEntries } from '../../packages/mobile-release/android-bundle-resources.mjs';
import { bundleHasText } from '../../packages/mobile-release/play-internal-android.ts';
import { filesystemSourceFiles, gitSourceFiles, readVerifiedSourceFile, resolveSourceCommit } from '../../packages/mobile-release/play-internal-source.mjs';

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

test('a source archive without git matches the tracked mobile sources and can name its commit', async () => {
  const tracked = gitSourceFiles(root).sort();
  const disk = await filesystemSourceFiles(root);
  assert.deepEqual(disk.filter(path => tracked.includes(path)), tracked);
  assert.ok(disk.includes('packages/mobile-release/play-internal-source.mjs'));
  const directory = await mkdtemp(join(tmpdir(), 'focus-play-source-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"version":"0.46.0"}\n');
    const resolved = resolveSourceCommit(directory, 'a'.repeat(40));
    assert.equal(resolved.git, false);
    assert.equal((await readVerifiedSourceFile(directory, resolved, 'package.json')).toString('utf8'), '{"version":"0.46.0"}\n');
    assert.throws(() => resolveSourceCommit(directory, 'HEAD'), /Source reference must resolve to a commit/);
    await assert.rejects(readVerifiedSourceFile(directory, resolved, '../package.json'), /Unsafe or duplicate source path/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const checkout = resolveSourceCommit(root, 'HEAD');
  assert.equal(checkout.git, true);
  assert.match(checkout.commit, /^[a-f0-9]{40}$/);
  const packaged = await readVerifiedSourceFile(root, checkout, 'apps/family-mobile/package.json');
  assert.match(packaged.toString('utf8'), /"version": "0.2.17"/);
});

function zipArchive(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data);
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc >>> 0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    central.push(centralHeader, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

test('deflated bundle resources still count as the Play internal app name', async () => {
  const label = 'Focus Island Preview';
  const payload = Buffer.from(`${'android-resource-'.repeat(400)}${label}${' pool'.repeat(400)}`);
  const directory = await mkdtemp(join(tmpdir(), 'focus-aab-label-'));
  const archive = join(directory, 'app.aab');
  try {
    await writeFile(archive, zipArchive([{ name: 'base/resources.pb', data: payload, method: 8 }]));
    const raw = await readFile(archive);
    assert.equal(bundleHasText(raw, label), false);
    const resources = readArchiveEntries(archive, /(^|\/)resources\.pb$/);
    assert.equal(bundleHasText(resources, label), true);
    assert.doesNotThrow(() => assertPlayInternalAppLabel(resources));
    await writeFile(archive, zipArchive([{ name: 'base/resources.pb', data: Buffer.from('no label here'.repeat(80)), method: 8 }]));
    assert.throws(() => assertPlayInternalAppLabel(readArchiveEntries(archive, /(^|\/)resources\.pb$/)), /Play internal app name was not packaged/);
    await writeFile(archive, zipArchive([{ name: 'base/resources.pb', data: Buffer.from(`${'x'.repeat(2000)}Focus Island Dev${'y'.repeat(2000)}`), method: 0 }]));
    assert.throws(() => assertPlayInternalAppLabel(readArchiveEntries(archive, /(^|\/)resources\.pb$/)), /Local development app name is still packaged/);
    await writeFile(archive, zipArchive([{ name: 'base/resources.pb', data: payload, method: 0 }]));
    assert.doesNotThrow(() => assertPlayInternalAppLabel(readArchiveEntries(archive, /(^|\/)resources\.pb$/)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
