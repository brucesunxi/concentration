import test from 'node:test';
import assert from 'node:assert/strict';
import { familyBillingCopy } from '../../packages/session-runtime/family-billing-copy.ts';
import type { FamilyBillingStatus } from '../../packages/contracts/family-billing.ts';

test('family billing explains the exact local expiry instant instead of a misleading date', () => {
  const status: FamilyBillingStatus = {
    version: 'family-billing-1', familyId: 'synthetic-family', state: 'active',
    validUntil: '2026-11-01T00:00:00.000Z', autoRenew: false, checkedAt: '2026-10-15T00:00:00.000Z',
  };
  const english = familyBillingCopy('en', status, 'America/New_York');
  assert.match(english.until!, /^Access expires at .*Oct 31, 2026.*8:00 PM.*EDT\.$/);
  assert.doesNotMatch(english.until!, /Nov 1/);
  const chinese = familyBillingCopy('zh-CN', status, 'Asia/Shanghai');
  assert.match(chinese.until!, /2026年11月1日.*08:00/);
  assert.match(chinese.until!, /GMT\+8/);
  assert.match(chinese.until!, /到期。$/);
});
