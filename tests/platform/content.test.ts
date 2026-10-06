import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { registerRelease } from '../../apps/api/content-registry.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import type { LocalContent } from '../../apps/api/content.ts';
import { ContentError, hashObject, sha256, signObject, trustedKeySchema, verifyRelease, verifyAsset, packSchema } from '../../packages/content/index.ts';
import type { Release, TrustedKey } from '../../packages/content/index.ts';
import { service } from '../../apps/api/service.ts';
import { TASKS, TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { contentNarration } from '../../packages/content/voice-catalogue.ts';
import {assessNarration} from '../../packages/content/narration-readiness.ts';
import { completeEvents } from './fixtures.ts';
import { reconcile } from '../../apps/family-web/src/journal.ts';
import { nativeVerifier } from '../../packages/content/native-verifier.ts';

let db: Database, content: LocalContent, preview: Release, trusted: TrustedKey[];
const now = Date.parse('2026-09-30T12:00:00Z');
before(async () => {
  db = await openDatabase('memory://'); await migrate(db); content = await createLocalContent(db, { now: () => now });
  preview = await content.get((await content.pick('memory', '6-8', 'zh-CN')).sha256); trusted = await content.trust();
});
after(async () => { await db.close(); });
const code = (value: string) => (e: unknown) => e instanceof ContentError && e.code === value;
test('the native verifier agrees with WebCrypto on all development packs and real asset bytes', async () => {
  const releases = await db.query<{ envelope: Release }>('SELECT envelope FROM content_releases');
  for (const { envelope } of releases.rows) {
    const pack = await verifyRelease(envelope, trusted, { mode: 'local', market: 'LOCAL', now, verifier: nativeVerifier });
    assert.equal(await hashObject(pack, nativeVerifier), envelope.body.packHash);
    for (const asset of pack.assets) await verifyAsset(asset, new Uint8Array(content.media.get(asset.path)!.body), nativeVerifier);
  }
  const altered = structuredClone(preview); altered.body.pack.copy.title += ' changed';
  await assert.rejects(verifyRelease(altered, trusted, { mode: 'local', market: 'LOCAL', now, verifier: nativeVerifier }), code('INVALID_SIGNATURE'));
});
test('native P256 verification accepts both valid S forms and rejects wrong keys and changed bytes', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey), body = new TextEncoder().encode('中文 · العربية · 🎈');
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, body));
  const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const s = BigInt('0x' + Buffer.from(signature.slice(32)).toString('hex'));
  const alternate = new Uint8Array(signature); alternate.set(Buffer.from((order - s).toString(16).padStart(64, '0'), 'hex'), 32);
  for (const sig of [signature, alternate]) {
    assert.equal(await nativeVerifier.verifyP256(body, sig, jwk), true);
    assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, body), true);
  }
  assert.equal(await nativeVerifier.verifyP256(new TextEncoder().encode('changed'), signature, jwk), false);
  assert.equal(await nativeVerifier.verifyP256(body, signature, { ...jwk, x: '0'.repeat(43) }), false);
  assert.equal(await nativeVerifier.verifyP256(body, signature.slice(0, 32), jwk), false);
});
async function identity(subject: string, role: TrustedKey['role']) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = trustedKeySchema.parse({ id: subject, subject, role, jwk: await crypto.subtle.exportKey('jwk', keys.publicKey) });
  return { privateKey: keys.privateKey, publicKey };
}
async function syntheticPublished(task: 'memory' | 'stop' = 'memory') {
  const publisher = await identity('synthetic-publisher', 'publisher'), method = await identity('synthetic-method-reviewer', 'method-reviewer'), language = await identity('synthetic-language-reviewer', 'language-reviewer');
  const source = task === 'memory' ? preview : await content.get((await content.pick('stop', '6-8', 'zh-CN')).sha256);
  const pack = structuredClone(source.body.pack); pack.review = 'approved'; pack.assets.forEach(a => { a.review = 'approved'; });
  const packHash = await hashObject(pack), approvals: Release['body']['approvals'] = [];
  for (const reviewer of [method, language]) {
    const body = { packHash, reviewer: reviewer.publicKey.subject, role: reviewer.publicKey.role as 'method-reviewer' | 'language-reviewer', approvedAt: new Date(now - 1000).toISOString(), evidence: 'Synthetic unit-test fixture, not a real content approval' };
    approvals.push({ body, signature: await signObject(body, reviewer.publicKey.id, reviewer.privateKey) });
  }
  const body: Release['body'] = { pack, packHash, author: 'synthetic-author', publisher: publisher.publicKey.subject, channel: 'published', markets: ['US'], issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), approvals };
  return { release: { body, signature: await signObject(body, publisher.publicKey.id, publisher.privateKey) }, publisher, method, language, trust: [publisher.publicKey, method.publicKey, language.publicKey] };
}
test('32 local content combinations are signed and remain explicitly unreviewed', async () => {
  const count = await db.query<{ n: number }>('SELECT count(*)::int n FROM content_releases'); assert.equal(count.rows[0].n, 32);
  const pack = await verifyRelease(preview, trusted, { mode: 'local', market: 'LOCAL', now });
  assert.equal(pack.review, 'unreviewed'); assert.equal(preview.body.approvals.length, 0);
  await assert.rejects(verifyRelease(preview, trusted, { mode: 'production', market: 'LOCAL', now }), code('LOCAL_ONLY_CONTENT'));
  await assert.rejects(verifyRelease(preview, trusted, { mode: 'production', market: 'US', now }), code('MARKET_NOT_APPROVED'));
});
test('every age, task and language has an exact fixed narration without changing the six prior releases', async () => {
  let old = 0, added = 0;
  for (const age of ['6-8', '9-11', '12-14', '15-17'] as const)
    for (const locale of ['zh-CN', 'en'] as const)
      for (const task of TASKS) {
        const narration = contentNarration(task, age, locale);
        const release = await content.get((await content.pick(task, age, locale)).sha256);
        const pack = release.body.pack;
        const guide = pack.assets.find(asset => asset.id === pack.audio?.assetId);
        assert.ok(guide);
        assert.equal(guide.mime, 'audio/mpeg');
        assert.equal(guide.locale, locale);
        assert.equal(guide.voice, narration.voice);
        assert.equal(guide.transcript, pack.copy[pack.audio!.copyKey]);
        assert.equal(pack.version, narration.existing ? '0.7.2-preview' : '0.7.3-preview');
        assert.equal(guide.review, 'unreviewed');
        if (narration.existing) old++; else added++;
      }
  assert.deepEqual({ old, added }, { old: 6, added: 26 });
});
test('one narration assessment drives the source inventory, studio warning and publication requirement',async()=>{
  const counts={rule:0,strategy:0};
  for(const age of ['6-8','9-11','12-14','15-17'] as const)
    for(const locale of ['zh-CN','en'] as const)
      for(const task of TASKS){
        const pack=(await content.get((await content.pick(task,age,locale)).sha256)).body.pack;
        const status=assessNarration(pack);
        assert.equal(status.attached,true);
        assert.equal(status.voiceIdentified,true);
        if(status.ruleAttached)counts.rule++;else {counts.strategy++;assert.equal(task,'stop');assert.equal(status.copyKey,'strategy');}
      }
  assert.deepEqual(counts,{rule:24,strategy:8});
  const missing=structuredClone(preview.body.pack);delete missing.audio;
  assert.equal(assessNarration(missing).attached,false);
  const unattributed=structuredClone(preview.body.pack);delete unattributed.assets.find(a=>a.id===unattributed.audio?.assetId)!.voice;
  assert.equal(assessNarration(unattributed).voiceIdentified,false);
});
test('tampered payloads and unknown signing keys fail verification', async () => {
  const altered = structuredClone(preview); altered.body.pack.copy.title = 'Altered title';
  await assert.rejects(verifyRelease(altered, trusted, { mode: 'local', market: 'LOCAL', now }), code('INVALID_SIGNATURE'));
  await assert.rejects(verifyRelease(preview, [], { mode: 'local', market: 'LOCAL', now }), code('UNKNOWN_SIGNING_KEY'));
});
test('published content requires two independent role-bound signatures', async () => {
  const fixture = await syntheticPublished();
  assert.equal((await verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now })).review, 'approved');
  fixture.release.body.approvals.pop();
  fixture.release.signature = await signObject(fixture.release.body, fixture.publisher.publicKey.id, fixture.publisher.privateKey);
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now }), code('TWO_REVIEWS_REQUIRED'));
});
test('published content requires a fixed, attributed narration matching its instruction', async () => {
  const fixture = await syntheticPublished();
  const signChanged = async () => {
    fixture.release.body.packHash = await hashObject(fixture.release.body.pack);
    fixture.release.signature = await signObject(fixture.release.body, fixture.publisher.publicKey.id, fixture.publisher.privateKey);
  };
  delete fixture.release.body.pack.audio;
  await signChanged();
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now }), code('AUDIO_COVERAGE_REQUIRED'));
  fixture.release.body.pack.audio = { assetId: 'guide', copyKey: 'rule' };
  const narration = fixture.release.body.pack.assets.find(a => a.id === 'guide')!;
  delete narration.voice;
  await signChanged();
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now }), code('AUDIO_COVERAGE_REQUIRED'));
});
test('published stop content cannot substitute a strategy recording for its rule', async () => {
  const fixture = await syntheticPublished('stop');
  assert.equal(fixture.release.body.pack.audio?.copyKey, 'strategy');
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now }), code('RULE_NARRATION_REQUIRED'));
  // Reviewed development previews retain their original signed content.
  fixture.release.body.channel = 'reviewed-preview';
  fixture.release.body.markets = ['LOCAL'];
  fixture.release.signature = await signObject(fixture.release.body, fixture.publisher.publicKey.id, fixture.publisher.privateKey);
  assert.equal((await verifyRelease(fixture.release, fixture.trust, { mode: 'local', market: 'LOCAL', now })).audio?.copyKey, 'strategy');
});
test('a publisher or author cannot also supply one of the required reviews', async () => {
  const fixture = await syntheticPublished();
  fixture.release.body.author = fixture.method.publicKey.subject;
  fixture.release.signature = await signObject(fixture.release.body, fixture.publisher.publicKey.id, fixture.publisher.privateKey);
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now }), code('REVIEWER_CONFLICT'));
});
test('valid signatures do not override expiry, region or missing human approval flags', async () => {
  const fixture = await syntheticPublished();
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'GB', now }), code('MARKET_NOT_APPROVED'));
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now: now + 86400000 }), code('RELEASE_EXPIRED_OR_FUTURE'));
  fixture.release.body.pack.assets[0].review = 'unreviewed'; fixture.release.body.packHash = await hashObject(fixture.release.body.pack);
  fixture.release.signature = await signObject(fixture.release.body, fixture.publisher.publicKey.id, fixture.publisher.privateKey);
  await assert.rejects(verifyRelease(fixture.release, fixture.trust, { mode: 'production', market: 'US', now }), code('REVIEW_INCOMPLETE'));
});
test('audio must match the single instruction source and assets must match their bytes', async () => {
  const pack = structuredClone(preview.body.pack);
  pack.copy.rule = 'Different words'; assert.equal(packSchema.safeParse(pack).success, false);
  const asset = preview.body.pack.assets[0], bytes = new Uint8Array(content.media.get(asset.path)!.body);
  await verifyAsset(asset, bytes); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(verifyAsset(asset, bytes), code('ASSET_INTEGRITY_FAILURE'));
  const injected = structuredClone(preview.body.pack); injected.assets[0].path = 'https://untrusted.example/file.js'; assert.equal(packSchema.safeParse(injected).success, false);
});
test('release identity is immutable and recalls survive catalogue reinitialization', async () => {
  const ref = await content.pick('search', '15-17', 'en');
  await content.recall(ref.sha256, 'synthetic-operator', 'Synthetic recall test');
  await assert.rejects(content.pick('search', '15-17', 'en'), code('CONTENT_RECALLED'));
  const again = await createLocalContent(db, { now: () => now });
  await assert.rejects(again.get(ref.sha256), code('CONTENT_RECALLED'));
  const count = await db.query<{ n: number }>('SELECT count(*)::int n FROM content_releases'); assert.equal(count.rows[0].n, 32);
});
test('built-in media disappears after its last active release is recalled', async () => {
  const isolated = await openDatabase('memory://');
  try {
    await migrate(isolated);
    const catalogue = await createLocalContent(isolated, { now: () => now });
    const ref = await catalogue.pick('search', '15-17', 'en');
    const selected = await catalogue.get(ref.sha256);
    const path = selected.body.pack.assets.find(asset => asset.id === selected.body.pack.audio?.assetId)!.path;
    const refs = await isolated.query<{ hash: string }>("SELECT hash FROM content_releases WHERE state='active' AND envelope->'body'->'pack'->'assets' @> $1::jsonb", [JSON.stringify([{ path }])]);
    assert.ok(refs.rows.length > 0);
    assert.ok(await catalogue.readMedia(path, true));
    for (const { hash } of refs.rows) await catalogue.recall(hash, 'synthetic-operator', 'Synthetic built-in media recall test');
    assert.equal(await catalogue.readMedia(path, true), undefined);
    assert.ok(await catalogue.readMedia(path), 'historical authoring evidence remains available to the studio');
  } finally { await isolated.close(); }
});
test('recall rejects old event retries before deduplication and closes the active session', async () => {
  const api = service(db, () => now, content);
  const auth = await api.setup({ name: 'Synthetic recall family', password: 'test-content-recall', timezone: 'UTC', locale: 'zh-CN', acknowledgedLocalUse: true });
  const parent = (await api.authenticate(auth.value))!;
  const child = await api.addChild(parent, { alias: 'Synthetic', ageBand: '12-14', locale: 'zh-CN', localConfirmation: true });
  const active = await api.start(parent, child.id, { task: 'sustain', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID());
  const scope = (await api.authenticate(active.auth.value))!, first = completeEvents(active.session.plan).slice(0, 1);
  await api.append(scope, active.session.id, { events: first });
  await content.recall(active.session.plan.content!.sha256, 'synthetic-operator', 'Synthetic recall test');
  await assert.rejects(api.append(scope, active.session.id, { events: first }), code('CONTENT_RECALLED'));
  assert.equal((await db.query<{ state: string }>('SELECT state FROM sessions WHERE id=$1', [active.session.id])).rows[0].state, 'revoked');
});
test('journal reconciliation detects changes inside nested presentation metadata', () => {
  const original = { id: randomUUID(), seq: 1, at: 0, type: 'present' as const, trialId: 't', presentation: { frameDeltaMs: 16, assetsReady: true, method: 'raf-pair' as const } };
  const reordered = JSON.parse(JSON.stringify(original));
  reordered.presentation = { method: 'raf-pair', assetsReady: true, frameDeltaMs: 16 };
  assert.equal(reconcile([original], [reordered]).length, 1);
  assert.throws(() => reconcile([original], [{ ...original, presentation: { ...original.presentation, frameDeltaMs: 500 } }]), /冲突/);
});

test('the registry rejects unsigned reviewer identities and immutable version replacement', async () => {
  const fixture = await syntheticPublished();
  await assert.rejects(registerRelease(db, fixture.release, { mode: 'production', market: 'US', now }), code('UNKNOWN_SIGNING_KEY'));
  for (const identity of fixture.trust) await db.query('INSERT INTO content_signers VALUES($1,$2)', [identity.id, identity]);
  await assert.rejects(registerRelease(db, fixture.release, { mode: 'production', market: 'US', now }), code('IMMUTABLE_VERSION_CONFLICT'));
  const count = await db.query<{ n: number }>('SELECT count(*)::int n FROM content_releases'); assert.equal(count.rows[0].n, 32);
});

test('a catalogue artwork upgrade preserves frozen historical releases and their original media after restart', async () => {
  const isolated = await openDatabase('memory://');
  try {
    await migrate(isolated);
    const publisher = await identity('synthetic-historical-publisher', 'publisher');
    await isolated.query('INSERT INTO content_signers VALUES($1,$2)', [publisher.publicKey.id, publisher.publicKey]);
    const originalBytes = new Uint8Array(await readFile(new URL('../../src/assets/objects-sheet.png', import.meta.url)));
    const originalHash = await sha256(originalBytes);
    const pack = structuredClone(preview.body.pack); pack.version = '0.3.0-preview';
    pack.assets[0] = { ...pack.assets[0], bytes: originalBytes.length, sha256: originalHash, path: `/content-assets/${originalHash}.png`, provenance: 'Synthetic historical release fixture using the actual original artwork' };
    const packHash = await hashObject(pack);
    const body: Release['body'] = { pack, packHash, author: 'synthetic-historical-author', publisher: publisher.publicKey.subject, channel: 'local-preview', markets: ['LOCAL'], issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), approvals: [] };
    const envelope: Release = { body, signature: await signObject(body, publisher.publicKey.id, publisher.privateKey) };
    await registerRelease(isolated, envelope, { mode: 'local', market: 'LOCAL', now });
    for (let initialization = 0; initialization < 2; initialization++) {
      const catalogue = await createLocalContent(isolated, { now: () => now });
      const historical = await catalogue.get(packHash);
      assert.deepEqual(historical, envelope);
      await verifyRelease(historical, await catalogue.trust(), { mode: 'local', market: 'LOCAL', now });
      await verifyAsset(historical.body.pack.assets[0], new Uint8Array(catalogue.media.get(pack.assets[0].path)!.body));
      const current = await catalogue.get((await catalogue.pick('memory', '6-8', 'zh-CN')).sha256);
      assert.equal(current.body.pack.version, '0.7.2-preview');
      assert.notEqual(current.body.packHash, packHash);
      assert.notEqual(current.body.pack.assets[0].sha256, originalHash);
      assert.ok(current.body.pack.assets[0].bytes < originalBytes.length / 2);
      assert.equal(current.body.pack.review, 'unreviewed');
    }
  } finally { await isolated.close(); }
});

test('the known blueberry-label preview is recalled without rewriting evidence and active retry attempts are rejected', async () => {
  const isolated = await openDatabase('memory://');
  try {
    await migrate(isolated);
    const catalogue = await createLocalContent(isolated, { now: () => now });
    const publisher = await identity('synthetic-visual-correction', 'publisher');
    await isolated.query('INSERT INTO content_signers VALUES($1,$2)', [publisher.publicKey.id, publisher.publicKey]);
    const pack = structuredClone(preview.body.pack); pack.version = '0.7.1-preview';
    const bytes = new Uint8Array(await readFile(new URL('../../packages/visuals/archive/objects-sheet-512-preview.png', import.meta.url))), digest = await sha256(bytes);
    pack.assets[0] = { ...pack.assets[0], bytes: bytes.length, sha256: digest, path: `/content-assets/${digest}.png` };
    const packHash = await hashObject(pack), body: Release['body'] = { pack, packHash, author: 'synthetic-author', publisher: publisher.publicKey.subject, channel: 'local-preview', markets: ['LOCAL'], issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), approvals: [] };
    const envelope: Release = { body, signature: await signObject(body, publisher.publicKey.id, publisher.privateKey) };
    await registerRelease(isolated, envelope, { mode: 'local', market: 'LOCAL', now });
    const api = service(isolated, () => now, catalogue);
    const auth = await api.setup({ name: 'Visual correction synthetic family', password: 'synthetic-visual-correction', timezone: 'UTC', locale: 'zh-CN', acknowledgedLocalUse: true });
    const parent = (await api.authenticate(auth.value))!;
    const child = await api.addChild(parent, { alias: 'Synthetic', ageBand: '6-8', locale: 'zh-CN', localConfirmation: true });
    const active = await api.start(parent, child.id, { task: 'memory', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID());
    // Model an actual pre-upgrade frozen plan without changing its trial protocol.
    await isolated.query('UPDATE sessions SET plan=$2 WHERE id=$1', [active.session.id, { ...active.session.plan, content: { id: pack.id, version: pack.version, sha256: packHash } }]);
    const restarted = await createLocalContent(isolated, { now: () => now });
    await assert.rejects(restarted.get(packHash), code('CONTENT_RECALLED'));
    const scope = (await api.authenticate(active.auth.value))!;
    await assert.rejects(api.append(scope, active.session.id, { events: completeEvents(active.session.plan).slice(0, 1) }), code('CONTENT_RECALLED'));
    const stopped = (await isolated.query<{ state: string; used_ms: number; budget_ms: number }>('SELECT state,used_ms,budget_ms FROM sessions WHERE id=$1', [active.session.id])).rows[0];
    assert.equal(stopped.state, 'revoked'); assert.equal(stopped.used_ms, stopped.budget_ms);
    assert.deepEqual((await isolated.query<{ envelope: Release }>('SELECT envelope FROM content_releases WHERE hash=$1', [packHash])).rows[0].envelope, envelope);
    await verifyAsset(pack.assets[0], new Uint8Array(restarted.media.get(pack.assets[0].path)!.body));
    await createLocalContent(isolated, { now: () => now });
    assert.equal((await isolated.query<{ n: number }>("SELECT count(*)::int n FROM content_audit WHERE hash=$1 AND action='recalled'", [packHash])).rows[0].n, 1);
  } finally { await isolated.close(); }
});
