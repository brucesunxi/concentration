import type { PracticeLimits } from '../contracts/practice-limits.ts';
import { nextFamilyDay } from './day-boundary.ts';

/** Use the server's family calendar; device date/clock changes must not postpone a read. */
export function practiceLimitsRefreshDelay(data: PracticeLimits | null): number {
  if (!data) return 60_000;
  const checkedAt = Date.parse(data.generatedAt);
  if (!Number.isFinite(checkedAt)) return 60_000;
  try { return Math.max(1000, Math.min(300_000, nextFamilyDay(checkedAt, data.timezone) - checkedAt + 250)); }
  catch { return 60_000; }
}

/** Budget-only refreshes preserve the draft; a changed arrangement requires a new acknowledgement. */
export function practiceLimitFormIdentity(data: PracticeLimits | null): string | null {
  if (!data) return null;
  return JSON.stringify([data.childId, data.ageBand, data.settingsVersion, data.canEdit, data.collectionActive,
    data.timezone, data.day, data.nextDay, data.maximumMinutes, data.currentMinutes, data.next?.minutes ?? null, data.next?.day ?? null]);
}
