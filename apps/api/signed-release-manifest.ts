import { createHash, createPublicKey, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonical } from '../../packages/content/index.ts';
import { createReleaseScope } from './release-scope.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const keyId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{3,119}$/);
const approval = z.object({ product: keyId, legal: keyId, security: keyId }).strict();
const rule = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  ageBand: z.enum(['6-8', '9-11', '12-14', '15-17']),
  locale: z.enum(['zh-CN', 'en']),
  platform: z.enum(['web', 'ios', 'android']),
  purpose: z.literal('family-practice'),
  access: z.enum(['open-pilot', 'family-entitlement']),
  consentNotice: z.object({ version: z.string().min(2).max(80), sha256: digest }).strict(),
  approvals: approval,
}).strict();
const manifest = z.object({ version: z.string().min(1).max(80), rules: z.array(rule).max(1000) }).strict();
const signature = z.object({ keyId, value: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
const signatures = z.object({ product: signature, legal: signature, security: signature }).strict();
const envelope = z.object({ schemaVersion: z.literal(1), sequence: z.number().int().positive().safe(), manifest, signatures }).strict();
const root = z.object({ keyId, publicKeyPem: z.string().min(1).max(4096) }).strict();
const roots = z.object({ product: root, legal: root, security: root }).strict();
const floorSchema = z.object({ sequence: z.number().int().nonnegative().safe(), sha256: digest }).strict();
export type SignedReleaseManifest = z.infer<typeof envelope>;
export type ReleaseTrustRoots = z.infer<typeof roots>;
export type ReleaseSequenceFloor = z.infer<typeof floorSchema>;
export const EMPTY_RELEASE_FLOOR: ReleaseSequenceFloor = { sequence: 0, sha256: '0'.repeat(64) };

const roles = ['product', 'legal', 'security'] as const;
function fail(code: string): never { throw new Error(code); }

// All three roles sign the same domain-separated bytes. The caller must pin
// independent public keys and supply a durable, trusted sequence floor.
export function verifySignedReleaseManifest(raw: unknown, rawRoots: unknown, rawFloor: unknown) {
  const parsed = envelope.safeParse(raw), trusted = roots.safeParse(rawRoots), floor = floorSchema.safeParse(rawFloor);
  if (!parsed.success) fail('RELEASE_MANIFEST_FORMAT_INVALID');
  if (!trusted.success) fail('RELEASE_MANIFEST_FORMAT_INVALID');
  if (!floor.success) fail('RELEASE_MANIFEST_FORMAT_INVALID');
  const signed = parsed.data;
  const scope = createReleaseScope(signed.manifest);
  const payload = Buffer.from(canonical({ domain: 'focus-island-release-scope-v1', schemaVersion: signed.schemaVersion, sequence: signed.sequence, manifest: signed.manifest }));
  const sha256 = createHash('sha256').update(payload).digest('hex');
  if (signed.sequence < floor.data.sequence || (signed.sequence === floor.data.sequence && sha256 !== floor.data.sha256)) fail('RELEASE_MANIFEST_ROLLBACK');
  const keyIds = new Set<string>(), fingerprints = new Set<string>();
  for (const role of roles) {
    const candidate = trusted.data[role], proof = signed.signatures[role];
    if (candidate.keyId !== proof.keyId) fail('RELEASE_SIGNER_MISMATCH');
    if (keyIds.has(candidate.keyId) || !candidate.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) fail('RELEASE_TRUST_ROOTS_INVALID');
    let publicKey: KeyObject;
    try { publicKey = createPublicKey(candidate.publicKeyPem); }
    catch { throw new Error('RELEASE_TRUST_ROOTS_INVALID'); }
    if (publicKey.asymmetricKeyType !== 'ed25519') fail('RELEASE_TRUST_ROOTS_INVALID');
    const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    if (fingerprints.has(fingerprint)) fail('RELEASE_TRUST_ROOTS_INVALID');
    keyIds.add(candidate.keyId); fingerprints.add(fingerprint);
    const bytes = Buffer.from(proof.value, 'base64url');
    if (bytes.length !== 64 || bytes.toString('base64url') !== proof.value || !verify(null, payload, publicKey, bytes)) fail('RELEASE_SIGNATURE_INVALID');
  }
  return { scope, sequence: signed.sequence, sha256, ruleCount: signed.manifest.rules.length, floor: { sequence: signed.sequence, sha256 } satisfies ReleaseSequenceFloor };
}
