import { createHash } from 'node:crypto';
import type { AgeBand, Locale } from '../../packages/task-engine/index.ts';

// Implementations must verify a provider-issued, single-use token with the
// provider, including adult guardian status and consent to the exact notice.
// The browser's assertion, account login and local preview checkbox are never
// verification evidence. There is intentionally no HTTP route yet.
export interface GuardianVerification {
  provider: string;
  reference: string;
  familyId: string;
  childId: string;
  ownerMemberId: string;
  country: string;
  ageBand: AgeBand;
  locale: Locale;
  purpose: 'family-practice';
  noticeVersion: string;
  noticeSha256: string;
  releaseScopeIdentity: string;
  adultGuardianVerified: true;
  purposeGranted: true;
  verifiedAt: number;
  expiresAt: number;
}
export interface GuardianVerifier {
  verify(opaqueToken: string, signal: AbortSignal): Promise<GuardianVerification | null>;
}
export interface GuardianExpected {
  familyId: string;
  childId: string;
  ownerMemberId: string;
  country: string;
  ageBand: AgeBand;
  locale: Locale;
  noticeVersion: string;
  noticeSha256: string;
  releaseScopeIdentity: string;
}

export function checkedGuardianVerification(proof: GuardianVerification | null, expected: GuardianExpected, at: number) {
  if (!proof || proof.adultGuardianVerified !== true || proof.purposeGranted !== true ||
    proof.purpose !== 'family-practice' ||
    !/^[a-z][a-z0-9_-]{2,39}$/.test(proof.provider) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(proof.reference) ||
    !Object.entries(expected).every(([key, value]) => proof[key as keyof GuardianVerification] === value) ||
    !Number.isSafeInteger(proof.verifiedAt) || !Number.isSafeInteger(proof.expiresAt) ||
    proof.verifiedAt > at || proof.verifiedAt < at - 10 * 60000 ||
    proof.expiresAt <= at || proof.expiresAt > at + 366 * 86400000) return null;
  return {
    provider: proof.provider,
    referenceHash: createHash('sha256').update(proof.provider + ':' + proof.reference).digest('hex'),
    verifiedAt: new Date(proof.verifiedAt).toISOString(),
    expiresAt: new Date(proof.expiresAt).toISOString(),
  };
}
