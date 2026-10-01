import { writeFile } from 'node:fs/promises';
import { openDatabase, migrate } from '../apps/api/database.ts';
import { createLocalContent } from '../apps/api/content.ts';
import { verifyRelease, verifyAsset } from '../packages/content/index.ts';
import type { Release } from '../packages/content/index.ts';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: npm run content:audit [-- --out path.json]');
// A fresh in-memory registry audits source assets without touching family records
// or reading the persistent development signing key.
const db = await openDatabase('memory://');
try {
  await migrate(db);
  const content = await createLocalContent(db), keys = await content.trust();
  const releases = await db.query<{ envelope: Release }>('SELECT envelope FROM content_releases ORDER BY pack_id,version');
  const packs = [];
  const uniqueAssets = new Map<string, { bytes: number; mime: string }>();
  for (const { envelope } of releases.rows) {
    const pack = await verifyRelease(envelope, keys, { mode: 'local', market: 'LOCAL' });
    for (const asset of pack.assets) {
      const media = content.media.get(asset.path);
      if (!media) throw new Error('Missing asset: ' + asset.id);
      await verifyAsset(asset, new Uint8Array(media.body));
      uniqueAssets.set(asset.sha256, { bytes: asset.bytes, mime: asset.mime });
    }
    packs.push({ id: pack.id, version: pack.version, sha256: envelope.body.packHash, task: pack.task, ageBand: pack.ageBand, locale: pack.locale, review: pack.review, channel: envelope.body.channel, markets: envelope.body.markets, audio: pack.audio ?? null, mediaBytes: pack.assets.reduce((sum, a) => sum + a.bytes, 0), assets: pack.assets.map(a => ({ id: a.id, sha256: a.sha256, mime: a.mime, bytes: a.bytes, review: a.review, ...(a.transcript ? { transcript: a.transcript } : {}) })) });
  }
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), scope: 'Source development catalogue; not a production approval or installed-database audit',
    summary: { packs: packs.length, reviewedPacks: packs.filter(p => p.review === 'approved').length, packsWithAudio: packs.filter(p => p.audio).length, uniqueAssets: uniqueAssets.size, uniqueMediaBytes: [...uniqueAssets.values()].reduce((sum, a) => sum + a.bytes, 0) }, packs,
  };
  if (args[1]) await writeFile(args[1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, ...(args[1] ? { report: args[1] } : {}), status: 'All catalogue signatures and asset hashes verified; human review pending.' }, null, 2));
} finally { await db.close(); }
