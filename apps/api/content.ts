import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { familyContent } from './family-content.ts';
import { registerRelease } from './content-registry.ts';
import { packSchema, trustedKeySchema, hashObject, sha256, signObject, verifyRelease, ContentError } from '../../packages/content/index.ts';
import type { ContentPack, Release, TrustedKey } from '../../packages/content/index.ts';
import { taskContent, isTeen } from '../../packages/content/copy.ts';
import { CONTENT_NARRATIONS, contentNarration, narrationText } from '../../packages/content/voice-catalogue.ts';
import { TASKS, ENGINE_VERSION, POLICY_VERSION } from '../../packages/task-engine/index.ts';
import type { TaskId, AgeBand, Locale, ContentReference } from '../../packages/task-engine/index.ts';
import type { Database, Queryable } from './database.ts';

const root = resolve(import.meta.dirname, '../..');
export async function createLocalContent(db: Database, options: { dataDir?: string; now?: () => number; readOnly?: boolean; delegatedRecall?: boolean } = {}) {
  const now = options.now ?? Date.now;
  let key: CryptoKey | undefined, identity: TrustedKey | undefined;
  if (!options.readOnly) {
  let jwk: JsonWebKey;
  const keyPath = options.dataDir ? resolve(options.dataDir, 'content-signing.jwk.json') : null;
  let saved: JsonWebKey | undefined;
  if (keyPath) { try { saved = JSON.parse(await readFile(keyPath, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  if (saved) {
    key = await crypto.subtle.importKey('jwk', saved, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const { d, key_ops, ...publicFields } = saved; jwk = { ...publicFields, key_ops: ['verify'] };
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    key = pair.privateKey; jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    if (keyPath) { await mkdir(options.dataDir!, { recursive: true, mode: 0o700 }); await writeFile(keyPath, JSON.stringify(await crypto.subtle.exportKey('jwk', key)), { mode: 0o600, flag: 'wx' }); }
  }
  identity = trustedKeySchema.parse({ id: 'local-publisher-' + (await hashObject(jwk)).slice(0, 16), subject: 'local-development-publisher', role: 'publisher', jwk });
  await db.query('INSERT INTO content_signers VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [identity.id, identity]);
  }
  const media = new Map<string, { body: Buffer; mime: string }>();
  async function asset(id: string, relative: string, extra = {}) {
    const body = await readFile(resolve(root, relative));
    const hash = await sha256(new Uint8Array(body));
    const mime = relative.endsWith('.mp3') ? 'audio/mpeg' : 'image/png';
    const path = `/content-assets/${hash}.${mime === 'image/png' ? 'png' : 'mp3'}`;
    media.set(path, { body, mime });
    return { id, path, sha256: hash, bytes: body.length, mime, review: 'unreviewed', provenance: `${relative}; development asset; professional review pending`, ...extra };
  }
  // Historical frozen plans still reference these exact bytes. Keep serving their
  // immutable URLs after the catalogue changes; never substitute the new artwork.
  await asset('characters', 'src/assets/characters-sheet.png');
  await asset('objects', 'src/assets/objects-sheet.png');
  // A live local preview registered this intermediate delivery size. Its release
  // remains immutable even though new plans now use the final 512px atlas.
  await asset('objects', 'packages/visuals/archive/objects-sheet-640-preview.png');
  await asset('objects', 'packages/visuals/archive/objects-sheet-512-preview.png');
  const characters = await asset('characters', 'packages/visuals/runtime/characters-sheet.png'), objects = await asset('objects', 'packages/visuals/runtime/objects-sheet.png');
  const audioAssets = new Map<string, Awaited<ReturnType<typeof asset>>>();
  for (const narration of CONTENT_NARRATIONS) {
    audioAssets.set(narration.relativePath, await asset('guide', narration.relativePath, {
      transcript: narrationText(narration), locale: narration.locale, voice: narration.voice,
    }));
  }
  const refs = new Map<string, ContentReference>();
  const preparedReleases = options.readOnly
    ? new Map((await db.query<{ pack_id: string; version: string; hash: string }>('SELECT pack_id,version,hash FROM content_releases')).rows.map(row => [`${row.pack_id}:${row.version}`, row.hash]))
    : undefined;
  for (const task of TASKS) for (const ageBand of ['6-8', '9-11', '12-14', '15-17'] as AgeBand[]) for (const locale of ['zh-CN', 'en'] as Locale[]) {
    const id = `focus.${task}.${ageBand}.${locale}`, teen = isTeen(ageBand);
    const assets = task === 'memory' ? [objects] : ['search', 'stop'].includes(task) && !teen ? [characters] : [];
    const narration = contentNarration(task, ageBand, locale);
    const guide = audioAssets.get(narration.relativePath);
    if (!guide) throw new ContentError('CONTENT_AUDIO_MISSING');
    const audio = { assetId: 'guide', copyKey: narration.copyKey };
    assets.push(guide);
    // The six existing child Chinese packs retain their immutable version and
    // hash. The 26 packs gaining audio receive a new version.
    const packVersion = narration.existing ? '0.7.2-preview' : '0.7.3-preview';
    const pack = packSchema.parse({ schemaVersion: 1, id, version: packVersion, task, ageBand, locale, engineVersion: ENGINE_VERSION, policyVersion: POLICY_VERSION, parameterSet: 'foundation-2', mode: 'training', copy: taskContent(task, locale, ageBand), assets, ...(audio ? { audio } : {}), review: 'unreviewed' });
    const hash = await hashObject(pack);
    const previous = preparedReleases ? (preparedReleases.has(`${id}:${packVersion}`) ? { hash: preparedReleases.get(`${id}:${packVersion}`)! } : undefined) : (await db.query<{ hash: string }>('SELECT hash FROM content_releases WHERE pack_id=$1 AND version=$2', [id, packVersion])).rows[0];
    if (previous && previous.hash !== hash) throw new ContentError('IMMUTABLE_VERSION_CONFLICT');
    if (!previous) {
      if (options.readOnly || !identity || !key) throw new ContentError('DATABASE_CONTENT_PREPARATION_REQUIRED');
      const body: Release['body'] = { pack, packHash: hash, author: 'development-catalog', publisher: identity.subject, channel: 'local-preview', markets: ['LOCAL'], issuedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 365 * 86400000).toISOString(), approvals: [] };
      const envelope: Release = { body, signature: await signObject(body, identity.id, key) };
      await registerRelease(db, envelope, { mode: 'local', market: 'LOCAL', now: now() });
    }
    refs.set(`${task}:${ageBand}:${locale}`, { id, version: packVersion, sha256: hash });
  }
  async function trust(tx: Queryable = db): Promise<TrustedKey[]> { return (await tx.query<{ identity: TrustedKey }>('SELECT identity FROM content_signers')).rows.map(x => trustedKeySchema.parse(x.identity)); }
  async function release(ref: ContentReference, tx: Queryable = db, lock = false): Promise<Release> {
    const sql = lock && db.context ? 'SELECT envelope,state FROM public.focus_locked_release($1)' : 'SELECT envelope,state FROM content_releases WHERE hash=$1' + (lock ? ' FOR SHARE' : '');
    const row = (await tx.query<{ envelope: Release; state: string }>(sql, [ref.sha256])).rows[0];
    if (!row) throw new ContentError('CONTENT_NOT_FOUND');
    if (row.state === 'recalled') throw new ContentError('CONTENT_RECALLED');
    const pack = await verifyRelease(row.envelope, await trust(tx), { mode: 'local', market: 'LOCAL', now: now() });
    if (pack.id !== ref.id || pack.version !== ref.version) throw new ContentError('CONTENT_REFERENCE_MISMATCH');
    return row.envelope;
  }
  const catalogue = {
    family: await familyContent(db,trust,{now,readOnly:options.readOnly,identity,key}),
    trust, media, release,
    async readMedia(path:string,publishedOnly=false,tx:Queryable=db){
      const builtIn=media.get(path);if(builtIn)return builtIn;
      const match=path.match(/^\/content-assets\/([a-f0-9]{64})\.(png|mp3)$/);if(!match)return undefined;
      if(publishedOnly){
        const publication=await tx.query("SELECT hash FROM content_releases WHERE state='active' AND envelope->'body'->>'channel' IN ('reviewed-preview','published') AND envelope->'body'->'pack'->'assets' @> $1::jsonb LIMIT 1",[JSON.stringify([{path}])]);
        if(!publication.rows.length)return undefined;
      }
      const row=(await tx.query<{hash:string;mime:string;bytes:number;body:Uint8Array}>('SELECT hash,mime,bytes,body FROM content_media_objects WHERE hash=$1',[match[1]])).rows[0];
      if(!row)return undefined;
      const body=Buffer.from(row.body);
      if(body.length!==row.bytes||await sha256(new Uint8Array(body))!==row.hash||(row.mime==='image/png')!==(match[2]==='png'))throw new ContentError('ASSET_INTEGRITY_FAILURE');
      return {body,mime:row.mime};
    },
    async get(hash: string) {
      const row = (await db.query<{ pack_id: string; version: string }>('SELECT pack_id,version FROM content_releases WHERE hash=$1', [hash])).rows[0];
      if (!row) throw new ContentError('CONTENT_NOT_FOUND');
      return release({ id: row.pack_id, version: row.version, sha256: hash });
    },
    async pick(task: TaskId, age: AgeBand, locale: Locale, tx: Queryable = db) {
      const selected=(await tx.query<{pack_id:string;version:string;hash:string}>('SELECT r.pack_id,r.version,r.hash FROM content_channels c JOIN content_releases r ON r.hash=c.hash WHERE c.slot=$1',[`${task}:${age}:${locale}`])).rows[0];
      if(selected){const ref={id:selected.pack_id,version:selected.version,sha256:selected.hash};await release(ref,tx,true);return ref;}
      const ref = refs.get(`${task}:${age}:${locale}`); if (!ref) throw new ContentError('CONTENT_NOT_FOUND');
      await release(ref, tx, true); return ref;
    },
    async recall(hash: string, actor: string, reason: string) {
      if (!actor.trim() || !reason.trim() || reason.length > 500) throw new ContentError('RECALL_REASON_REQUIRED');
      await db.transaction(async tx => {
        const prior = (await tx.query<{ state: string }>('SELECT state FROM content_releases WHERE hash=$1 FOR UPDATE', [hash])).rows[0];
        if (!prior) throw new ContentError('CONTENT_NOT_FOUND'); if (prior.state === 'recalled') return;
        await tx.query("UPDATE content_releases SET state='recalled',recalled_at=$2,reason=$3 WHERE hash=$1", [hash, new Date(now()).toISOString(), reason]);
        await tx.query('INSERT INTO content_audit VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), hash, 'recalled', actor, new Date(now()).toISOString(), reason]);
      });
      if (options.delegatedRecall) {
        await db.query('SELECT public.focus_revoke_recalled_sessions($1)', [hash]);
        return;
      }
      // Do not hold a release lock while waiting for a child/session lock.
      const active = await db.query<{ id: string; child_id: string }>("SELECT id,child_id FROM sessions WHERE state='active' AND plan->'content'->>'sha256'=$1", [hash]);
      for (const session of active.rows) await db.transaction(async tx => {
        await tx.query('SELECT id FROM children WHERE id=$1 FOR UPDATE', [session.child_id]);
        await tx.query("UPDATE sessions SET state='revoked',used_ms=budget_ms WHERE id=$1 AND state='active'", [session.id]);
      });
    },
  };
  // Correct an actual local authoring defect, never rewrite its signed release.
  // These preview memory images showed a blackberry while Chinese said blueberry.
  // The existing recall path also revokes active sessions before accepting retries.
  const withdrawn = options.readOnly ? { rows: [] } : await db.query<{ hash: string }>("SELECT hash FROM content_releases WHERE version IN ('0.7.0-preview','0.7.1-preview') AND pack_id LIKE 'focus.memory.%' AND envelope->'body'->>'channel'='local-preview'");
  for (const { hash } of withdrawn.rows) await catalogue.recall(hash, 'local-catalogue-correction', 'Local memory artwork did not match the blueberry label; corrected in 0.7.2-preview.');
  return catalogue;
}
export type LocalContent = Awaited<ReturnType<typeof createLocalContent>>;
