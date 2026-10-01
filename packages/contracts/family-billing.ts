export interface FamilyBillingStatus {
  version: 'family-billing-1';
  familyId: string;
  state: 'preview' | 'free' | 'active' | 'grace' | 'expired' | 'refunded';
  validUntil: string | null;
  autoRenew: boolean | null;
  checkedAt: string;
}
