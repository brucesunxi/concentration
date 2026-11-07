import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewInvite, canSubmitInvite } from '../../packages/session-runtime/invite-draft.ts';
import { isPositiveFrameDelta, shouldRetryPresentationArm, PRESENTATION_ARM_ATTEMPTS } from '../../packages/session-runtime/presentation-ready.ts';

test('invite draft requires children and acknowledgment before review', () => {
  assert.equal(canReviewInvite([], true), false);
  assert.equal(canReviewInvite(['a'], false), false);
  assert.equal(canReviewInvite(['a', 'a'], true), false);
  assert.equal(canReviewInvite(['a', 'b', 'c', 'd'], true), false);
  assert.equal(canReviewInvite(['a'], true), true);
});

test('invite submit stays blocked until confirm step, second ack, and no visible code', () => {
  const base = { selectedChildIds: ['child-1'], confirmAcknowledged: true, codeShowing: false, busy: false };
  assert.equal(canSubmitInvite({ ...base, step: 'select' }), false);
  assert.equal(canSubmitInvite({ ...base, step: 'confirm', confirmAcknowledged: false }), false);
  assert.equal(canSubmitInvite({ ...base, step: 'confirm', codeShowing: true }), false);
  assert.equal(canSubmitInvite({ ...base, step: 'confirm', busy: true }), false);
  assert.equal(canSubmitInvite({ ...base, step: 'confirm', selectedChildIds: [] }), false);
  assert.equal(canSubmitInvite({ ...base, step: 'confirm' }), true);
});

test('presentation arming retries zero-delta and missing assets before failing', () => {
  assert.equal(isPositiveFrameDelta(0), false);
  assert.equal(isPositiveFrameDelta(-1), false);
  assert.equal(isPositiveFrameDelta(16), true);
  assert.equal(shouldRetryPresentationArm({ attempt: 0, frameDeltaMs: 0, assetsReady: true }), true);
  assert.equal(shouldRetryPresentationArm({ attempt: 0, frameDeltaMs: 16, assetsReady: false }), true);
  assert.equal(shouldRetryPresentationArm({ attempt: 0, frameDeltaMs: 16, assetsReady: true }), false);
  assert.equal(shouldRetryPresentationArm({ attempt: PRESENTATION_ARM_ATTEMPTS, frameDeltaMs: 0, assetsReady: true }), false);
});
