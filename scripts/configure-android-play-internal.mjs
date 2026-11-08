import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlayInternalReleaseSigning } from '../packages/mobile-release/android-play-signing.mjs';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));

try {
  if (process.env.FOCUS_ANDROID_DISTRIBUTION !== 'play-internal') throw new Error('PLAY_INTERNAL_DISTRIBUTION_REQUIRED');
  if (process.argv.length !== 4 || process.argv[2] !== '--gradle' || !process.argv[3] || process.argv[3].startsWith('--')) throw new Error('UNEXPECTED_ARGUMENT');
  const gradlePath = await realpath(resolve(process.argv[3]));
  if (!gradlePath.startsWith(root + sep)) throw new Error('PLAY_INTERNAL_GRADLE_PATH_INVALID');
  const patched = applyPlayInternalReleaseSigning(await readFile(gradlePath, 'utf8'));
  await writeFile(gradlePath, patched);
  console.log(JSON.stringify({ ok: true, releaseSigning: 'play-internal-upload-key' }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PLAY_INTERNAL_GRADLE_PATCH_FAILED');
  process.exitCode = 1;
}
