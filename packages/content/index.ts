import { z } from 'zod';

export const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const utf8 = (value: unknown) => new TextEncoder().encode(canonical(value));
export interface ContentVerifier {
  sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
  verifyP256(bytes: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>, jwk: JsonWebKey): Promise<boolean>;
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>, verifier?: ContentVerifier) { return verifier ? verifier.sha256(bytes) : [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join(''); }
export const hashObject = (value: unknown, verifier?: ContentVerifier) => sha256(utf8(value), verifier);
const digest = z.string().regex(/^[a-f0-9]{64}$/), name = z.string().min(1).max(120), text = z.string().min(1).max(1000);
const publicJwk = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().regex(/^[\w-]{43}$/), y: z.string().regex(/^[\w-]{43}$/), key_ops: z.array(z.literal('verify')).optional(), ext: z.boolean().optional() }).strict();
export const trustedKeySchema = z.object({ id: name, subject: name, role: z.enum(['publisher', 'method-reviewer', 'language-reviewer']), jwk: publicJwk }).strict();
export type TrustedKey = z.infer<typeof trustedKeySchema>;
const assetSchema = z.object({
  id: name, path: z.string().regex(/^\/content-assets\/[a-f0-9]{64}\.(png|mp3)$/), sha256: digest,
  bytes: z.number().int().positive().max(20000000), mime: z.enum(['image/png', 'audio/mpeg']),
  review: z.enum(['unreviewed', 'approved']), provenance: text,
  transcript: z.string().max(1000).optional(), voice: name.optional(), locale: z.enum(['zh-CN', 'en']).optional(),
}).strict();
export const packSchema = z.object({
  schemaVersion: z.literal(1), id: name, version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  task: z.enum(['search', 'stop', 'memory', 'sustain']), ageBand: z.enum(['6-8', '9-11', '12-14', '15-17']), locale: z.enum(['zh-CN', 'en']),
  engineVersion: z.literal('2.0.0'), policyVersion: z.literal('conservative-2'), parameterSet: z.literal('foundation-2'), mode: z.literal('training'),
  copy: z.object({ title: text, skill: text, rule: text, strategy: text, transfer: text, color: z.enum(['sage', 'peach', 'lavender', 'sand']), minutes: z.number().int().min(1).max(12) }).strict(),
  assets: z.array(assetSchema).max(20),
  audio: z.object({ assetId: name, copyKey: z.enum(['rule', 'strategy']) }).strict().optional(),
  review: z.enum(['unreviewed', 'approved']),
}).strict().superRefine((pack, ctx) => {
  const ids = pack.assets.map(a => a.id);
  const required = pack.task === 'memory' ? 'objects' : ['search', 'stop'].includes(pack.task) && ['6-8', '9-11'].includes(pack.ageBand) ? 'characters' : null;
  if (required && !ids.includes(required)) ctx.addIssue({ code: 'custom', message: 'Required stimulus artwork is missing' });
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate asset identifiers' });
  if (pack.assets.reduce((sum, asset) => sum + asset.bytes, 0) > 20000000) ctx.addIssue({ code: 'custom', message: 'Content pack exceeds the media budget' });
  for (const asset of pack.assets) {
    if (!asset.path.includes('/' + asset.sha256 + '.')) ctx.addIssue({ code: 'custom', message: 'Asset path must match its digest' });
    if ((asset.mime === 'image/png') !== asset.path.endsWith('.png')) ctx.addIssue({ code: 'custom', message: 'Asset type mismatch' });
  }
  if (pack.audio) {
    const asset = pack.assets.find(a => a.id === pack.audio?.assetId);
    if (!asset || asset.mime !== 'audio/mpeg' || asset.locale !== pack.locale || asset.transcript !== pack.copy[pack.audio.copyKey]) ctx.addIssue({ code: 'custom', message: 'Audio, transcript and instruction must agree' });
  }
});
export type ContentPack = z.infer<typeof packSchema>;
const signature = z.object({ keyId: name, value: z.string().regex(/^[a-f0-9]{128}$/) }).strict();
const approvalSchema = z.object({ body: z.object({ packHash: digest, reviewer: name, role: z.enum(['method-reviewer', 'language-reviewer']), approvedAt: z.iso.datetime(), evidence: text }).strict(), signature }).strict();
export const releaseSchema = z.object({
  body: z.object({ pack: packSchema, packHash: digest, author: name, publisher: name, channel: z.enum(['local-preview', 'reviewed-preview', 'published']), markets: z.array(z.string().regex(/^(LOCAL|[A-Z]{2})$/)).min(1).max(250), issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), approvals: z.array(approvalSchema).max(10) }).strict(),
  signature,
}).strict();
export type Release = z.infer<typeof releaseSchema>;
export class ContentError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
const check = (value: unknown, code: string) => { if (!value) throw new ContentError(code); };
const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!.map(x => parseInt(x, 16)));
export async function signObject(body: unknown, keyId: string, key: CryptoKey) {
  const bytes = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(body)));
  return { keyId, value: [...bytes].map(x => x.toString(16).padStart(2, '0')).join('') };
}
export async function verifySigned(body: unknown, sig: z.infer<typeof signature>, trusted: TrustedKey[], verifier?: ContentVerifier) {
  const identity = trusted.find(k => k.id === sig.keyId); check(identity, 'UNKNOWN_SIGNING_KEY');
  trustedKeySchema.parse(identity);
  const bytes = utf8(body), signatureBytes = fromHex(sig.value);
  if (verifier) check(await verifier.verifyP256(bytes, signatureBytes, identity!.jwk), 'INVALID_SIGNATURE');
  else {
    const key = await crypto.subtle.importKey('jwk', identity!.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    check(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, bytes), 'INVALID_SIGNATURE');
  }
  return identity!;
}
export async function verifyRelease(raw: unknown, trusted: TrustedKey[], options: { mode: 'local' | 'production'; market: string; now?: number; verifier?: ContentVerifier }) {
  const release = releaseSchema.parse(raw), { body } = release, now = options.now ?? Date.now();
  const signer = await verifySigned(body, release.signature, trusted, options.verifier);
  check(signer.role === 'publisher' && signer.subject === body.publisher, 'PUBLISHER_MISMATCH');
  check(await hashObject(body.pack, options.verifier) === body.packHash, 'PACK_HASH_MISMATCH');
  check(Date.parse(body.issuedAt) <= now + 60000 && Date.parse(body.expiresAt) > now && Date.parse(body.expiresAt) > Date.parse(body.issuedAt), 'RELEASE_EXPIRED_OR_FUTURE');
  check(body.markets.includes(options.market), 'MARKET_NOT_APPROVED');
  if (body.channel === 'local-preview') {
    check(options.mode === 'local' && options.market === 'LOCAL' && body.markets.length === 1 && body.approvals.length === 0, 'LOCAL_ONLY_CONTENT');
  } else {
    if(body.channel==='reviewed-preview')check(options.mode==='local'&&options.market==='LOCAL'&&body.markets.length===1&&body.markets[0]==='LOCAL','LOCAL_ONLY_CONTENT');
    else check(!body.markets.includes('LOCAL'),'REVIEW_INCOMPLETE');
    check(body.pack.review === 'approved' && body.pack.assets.every(a => a.review === 'approved'), 'REVIEW_INCOMPLETE');
    if (body.channel === 'published') {
      const narration = body.pack.assets.find(a => a.id === body.pack.audio?.assetId);
      check(body.pack.audio && narration?.mime === 'audio/mpeg' && narration.voice, 'AUDIO_COVERAGE_REQUIRED');
      check(body.pack.audio?.copyKey === 'rule', 'RULE_NARRATION_REQUIRED');
    }
    const identities = new Set<string>(), roles = new Set<string>();
    for (const approval of body.approvals) {
      const reviewer = await verifySigned(approval.body, approval.signature, trusted, options.verifier);
      check(reviewer.subject === approval.body.reviewer && reviewer.role === approval.body.role && approval.body.packHash === body.packHash, 'APPROVAL_MISMATCH');
      check(reviewer.subject !== body.author && reviewer.subject !== body.publisher && !identities.has(reviewer.subject), 'REVIEWER_CONFLICT');
      check(Date.parse(approval.body.approvedAt) <= Date.parse(body.issuedAt), 'APPROVAL_AFTER_RELEASE');
      identities.add(reviewer.subject); roles.add(reviewer.role);
    }
    check(roles.has('method-reviewer') && roles.has('language-reviewer'), 'TWO_REVIEWS_REQUIRED');
  }
  return body.pack;
}
export async function verifyAsset(asset: ContentPack['assets'][number], bytes: Uint8Array<ArrayBuffer>, verifier?: ContentVerifier) {
  check(bytes.byteLength === asset.bytes && await sha256(bytes, verifier) === asset.sha256, 'ASSET_INTEGRITY_FAILURE');
}
