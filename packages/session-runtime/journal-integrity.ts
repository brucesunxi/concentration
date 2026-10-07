import { hashObject } from '../content/index.ts';
import type { ContentVerifier } from '../content/index.ts';
import type { EngineEvent } from '../task-engine/index.ts';

/** Legacy native rows predate per-journal hashes and must never be called verified. */
export async function verifyJournalEvents(eventsJson: string, expectedHash: string | null, verifier?: ContentVerifier) {
  let events: EngineEvent[];
  try { events = JSON.parse(eventsJson) as EngineEvent[]; }
  catch { throw new Error('LOCAL_EXPORT_UNREADABLE'); }
  if (!Array.isArray(events)) throw new Error('LOCAL_EXPORT_UNREADABLE');
  const sha256 = await hashObject(events, verifier);
  if (expectedHash !== null && expectedHash !== sha256) throw new Error('LOCAL_EXPORT_INTEGRITY_FAILURE');
  return { events, sha256, integrity: expectedHash === null ? 'legacy-unverified' : 'verified' } as const;
}
