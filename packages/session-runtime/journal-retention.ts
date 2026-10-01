export const UNSYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const UNSYNCED_WARNING_MS = 24 * 60 * 60 * 1000;

export function retentionClock(current: number, previous = 0) {
  if (!Number.isFinite(current) || current < 0) throw new Error('LOCAL_CLOCK_INVALID');
  return Math.max(current, Number.isFinite(previous) && previous >= 0 ? previous : 0);
}

export function journalExpired(createdAt: number, effectiveNow: number) {
  return !Number.isFinite(createdAt) || createdAt < 0 || effectiveNow - createdAt >= UNSYNCED_RETENTION_MS;
}

export function journalExpiringSoon(createdAt: number, effectiveNow: number) {
  return !journalExpired(createdAt, effectiveNow) && effectiveNow - createdAt >= UNSYNCED_RETENTION_MS - UNSYNCED_WARNING_MS;
}
