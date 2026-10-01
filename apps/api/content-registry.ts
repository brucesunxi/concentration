import { randomUUID } from 'node:crypto';
import { ContentError, releaseSchema, trustedKeySchema, verifyRelease } from '../../packages/content/index.ts';
import type { TrustedKey } from '../../packages/content/index.ts';
import type { Database, Queryable } from './database.ts';

/** The trust store is operator-controlled; a release cannot introduce its own trusted reviewers. */
export async function registerRelease(db: Database, raw: unknown, options: { mode: 'local' | 'production'; market: string; now: number }) {
  try{return await db.transaction(tx=>registerReleaseInTransaction(tx,raw,options));}
  catch(e){if((e as {code?:string}).code==='23505')throw new ContentError('IMMUTABLE_VERSION_CONFLICT');throw e;}
}
export async function registerReleaseInTransaction(tx:Queryable,raw:unknown,options:{mode:'local'|'production';market:string;now:number}){
  const release = releaseSchema.parse(raw);
  const trusted = (await tx.query<{ identity: TrustedKey }>('SELECT identity FROM content_signers')).rows.map(x => trustedKeySchema.parse(x.identity));
  const pack = await verifyRelease(release, trusted, options);
      const existing = (await tx.query<{ hash: string }>('SELECT hash FROM content_releases WHERE pack_id=$1 AND version=$2 FOR UPDATE', [pack.id, pack.version])).rows[0];
      if (existing) { if (existing.hash !== release.body.packHash) throw new ContentError('IMMUTABLE_VERSION_CONFLICT'); return existing.hash; }
      await tx.query("INSERT INTO content_releases(hash,pack_id,version,envelope,state) VALUES($1,$2,$3,$4,'active')", [release.body.packHash, pack.id, pack.version, release]);
      await tx.query('INSERT INTO content_audit VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), release.body.packHash, release.body.channel === 'local-preview' ? 'local-preview-registered' : release.body.channel==='reviewed-preview'?'reviewed-preview-registered':'published', release.body.publisher, new Date(options.now).toISOString(), release.body.channel === 'local-preview' ? 'Development preview, no human approval asserted' : 'Validated publisher and two independent signed reviews; channel='+release.body.channel]);
      return release.body.packHash;
}
