import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { measureNarrationQuality } from './voice-engineering-quality.mjs';

// Check a new candidate before it becomes visible at its final path. A hard
// link creates the final name only if absent, including under concurrent runs.
export async function saveVoiceCandidate(path, body, durationMs) {
  await mkdir(dirname(path), { recursive:true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, body, { flag:'wx' });
  try {
    const quality = await measureNarrationQuality(temporary, durationMs);
    try { await link(temporary, path); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Voice candidate already exists; inspect it before retrying: ${path}`);
      throw error;
    }
    return quality;
  } finally {
    await rm(temporary, { force:true });
  }
}
