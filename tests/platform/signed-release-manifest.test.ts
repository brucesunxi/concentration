import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { canonical } from '../../packages/content/index.ts';
import { EMPTY_RELEASE_FLOOR, verifySignedReleaseManifest } from '../../apps/api/signed-release-manifest.ts';
import type { ReleaseTrustRoots, SignedReleaseManifest } from '../../apps/api/signed-release-manifest.ts';

const roles = ['product', 'legal', 'security'] as const;
const keys = Object.fromEntries(roles.map(role => [role, generateKeyPairSync('ed25519')])) as Record<typeof roles[number], { publicKey: KeyObject; privateKey: KeyObject }>;
const roots = Object.fromEntries(roles.map(role => [role, { keyId: `${role}/test-2026`, publicKeyPem: keys[role].publicKey.export({ format: 'pem', type: 'spki' }).toString() }])) as ReleaseTrustRoots;
const manifest: SignedReleaseManifest['manifest'] = { version: '2026-10-02.us-pilot', rules: [{
  country: 'US', ageBand: '9-11', locale: 'en', platform: 'web', purpose: 'family-practice', access: 'open-pilot',
  consentNotice: { version: 'family-practice-1', sha256: 'a'.repeat(64) },
  approvals: { product: 'product/ticket-1234', legal: 'legal/ticket-1234', security: 'security/ticket-1234' },
}] };
const makeEnvelope = (sequence: number, body: SignedReleaseManifest['manifest'] = structuredClone(manifest)): SignedReleaseManifest => {
  const payload = Buffer.from(canonical({ domain: 'focus-island-release-scope-v1', schemaVersion: 1, sequence, manifest: body }));
  return { schemaVersion: 1, sequence, manifest: body, signatures: Object.fromEntries(roles.map(role => [role, {
    keyId: roots[role].keyId, value: sign(null, payload, keys[role].privateKey).toString('base64url'),
  }])) as SignedReleaseManifest['signatures'] };
};

test('three independent role signatures authenticate a closed-by-default release matrix', () => {
  const signed = makeEnvelope(7);
  const verified = verifySignedReleaseManifest(signed, roots, EMPTY_RELEASE_FLOOR);
  assert.equal(verified.scope.permits('US', '9-11', 'en', 'web'), true);
  assert.equal(verified.scope.permits('CA', '9-11', 'en', 'web'), false);
  assert.deepEqual(verifySignedReleaseManifest(signed, roots, verified.floor).floor, verified.floor);
  assert.throws(() => verifySignedReleaseManifest(makeEnvelope(6), roots, verified.floor), /RELEASE_MANIFEST_ROLLBACK/);
  assert.throws(() => verifySignedReleaseManifest(makeEnvelope(7, { ...manifest, version: '2026-10-02.changed' }), roots, verified.floor), /RELEASE_MANIFEST_ROLLBACK/);
  assert.equal(verifySignedReleaseManifest(makeEnvelope(8), roots, verified.floor).sequence, 8);
});

test('tampering, missing approval, wrong signer and duplicated trust roots fail closed', () => {
  const signed = makeEnvelope(3);
  assert.throws(() => verifySignedReleaseManifest({ ...signed, manifest: { ...signed.manifest, rules: [{ ...signed.manifest.rules[0], access: 'family-entitlement' }] } }, roots, EMPTY_RELEASE_FLOOR), /RELEASE_SIGNATURE_INVALID/);
  assert.throws(() => verifySignedReleaseManifest({ ...signed, signatures: { ...signed.signatures, legal: signed.signatures.product } }, roots, EMPTY_RELEASE_FLOOR), /RELEASE_SIGNER_MISMATCH/);
  assert.throws(() => verifySignedReleaseManifest({ ...signed, signatures: { ...signed.signatures, legal: undefined } }, roots, EMPTY_RELEASE_FLOOR), /RELEASE_MANIFEST_FORMAT_INVALID/);
  assert.throws(() => verifySignedReleaseManifest(signed, { ...roots, legal: { ...roots.legal, publicKeyPem: roots.product.publicKeyPem } }, EMPTY_RELEASE_FLOOR), /RELEASE_TRUST_ROOTS_INVALID/);
  assert.throws(() => verifySignedReleaseManifest({ ...signed, extra: true }, roots, EMPTY_RELEASE_FLOOR), /RELEASE_MANIFEST_FORMAT_INVALID/);
  assert.throws(() => verifySignedReleaseManifest(makeEnvelope(4, { ...manifest, rules: [] }), roots, { sequence: 4, sha256: 'f'.repeat(64) }), /RELEASE_MANIFEST_ROLLBACK/);
});
