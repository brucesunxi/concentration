import type { FamilyBillingStatus } from '../contracts/family-billing.ts';

const MAX_REFRESH_MS = 5 * 60_000;
const MIN_REFRESH_MS = 15_000;

/** Use server timestamps so a device clock change cannot postpone an expiry check. */
export function familyBillingRefreshDelay(status: FamilyBillingStatus | null): number {
  if (!status) return 60_000;
  const remaining = status.validUntil ? Date.parse(status.validUntil) - Date.parse(status.checkedAt) : MAX_REFRESH_MS;
  return Number.isFinite(remaining) ? Math.max(MIN_REFRESH_MS, Math.min(MAX_REFRESH_MS, remaining)) : MAX_REFRESH_MS;
}
