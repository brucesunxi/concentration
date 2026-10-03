import test from 'node:test';
import assert from 'node:assert/strict';
import { familyBillingRefreshDelay } from '../../packages/session-runtime/family-billing-refresh.ts';
import type { FamilyBillingStatus } from '../../packages/contracts/family-billing.ts';

test('billing status rechecks near its server-authoritative expiry even if the device clock is wrong', () => {
  const status: FamilyBillingStatus = {
    version: 'family-billing-1', familyId: 'synthetic-family', state: 'active',
    checkedAt: '2026-10-31T23:59:30.000Z', validUntil: '2026-11-01T00:00:00.000Z', autoRenew: false,
  };
  assert.equal(familyBillingRefreshDelay(status), 30_000);
  assert.equal(familyBillingRefreshDelay({ ...status, checkedAt: status.validUntil! }), 15_000);
  assert.equal(familyBillingRefreshDelay({ ...status, validUntil: null }), 300_000);
  assert.equal(familyBillingRefreshDelay(null), 60_000);
});
