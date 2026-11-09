import { playInternalPrerequisites } from '../packages/mobile-release/play-internal-android.ts';

try {
  if (process.argv.length !== 2) throw new Error('UNEXPECTED_ARGUMENT');
  const ready = playInternalPrerequisites(process.env);
  console.log(JSON.stringify({ ok: true, origin: ready.origin, certificateSha256: ready.certificateSha256 }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PLAY_INTERNAL_PREREQUISITES_FAILED');
  process.exitCode = 1;
}
