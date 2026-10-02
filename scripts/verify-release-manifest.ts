import { readFile } from 'node:fs/promises';
import { verifySignedReleaseManifest } from '../apps/api/signed-release-manifest.ts';

const [manifestPath, rootsPath, floorPath, ...extra] = process.argv.slice(2);
if (!manifestPath || !rootsPath || !floorPath || extra.length) {
  console.error('Usage: npm run release:verify -- <signed-manifest.json> <trusted-public-keys.json> <trusted-sequence-floor.json>');
  process.exitCode = 2;
} else {
  try {
    const readJson = async (path: string) => {
      const data = await readFile(path);
      if (data.length > 1024 * 1024) throw new Error('RELEASE_INPUT_TOO_LARGE');
      return JSON.parse(data.toString('utf8')) as unknown;
    };
    const [signed, roots, floor] = await Promise.all([readJson(manifestPath), readJson(rootsPath), readJson(floorPath)]);
    const result = verifySignedReleaseManifest(signed, roots, floor);
    console.log(JSON.stringify({ verified: true, version: result.scope.version, sequence: result.sequence, sha256: result.sha256, ruleCount: result.ruleCount, nextFloor: result.floor }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'RELEASE_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}
