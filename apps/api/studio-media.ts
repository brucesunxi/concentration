import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {canonical} from '../../packages/content/index.ts';
import {MEDIA_IMPORT_TTL_MS,MEDIA_STORAGE_LIMIT,mediaImportSchema,mediaMime,mediaPath} from '../../packages/content/media-library.ts';
import type {LibraryMedia} from '../../packages/content/media-library.ts';
import type {Database,Queryable} from './database.ts';
import {digest,studioFail,StudioError} from './studio-auth.ts';
import type {StudioAuth,StudioPrincipal} from './studio-auth.ts';
import {processMedia} from './media-processor.ts';
const bytesHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const roles=['editor','method-reviewer','language-reviewer','publisher'] as const;
interface Row extends LibraryMedia{request_hash:string;request_key:string}
const publicRow=({request_hash,request_key,...r}:Row):LibraryMedia=>r;
export function studioMedia(db:Database,auth:StudioAuth,now=Date.now){
  async function audit(tx:Queryable,p:StudioPrincipal,action:string,detail:Record<string,unknown>){await tx.query('INSERT INTO studio_audit VALUES($1,NULL,$2,$3,$4,$5)',[randomUUID(),p.id,action,new Date(now()).toISOString(),detail]);}
  async function own(tx:Queryable,p:StudioPrincipal,id:string){
    z.uuid().parse(id);await auth.current(tx,p,['editor']);
    const row=(await tx.query<Row>('SELECT * FROM studio_media WHERE id=$1',[id])).rows[0];
    if(!row||row.actor!==p.id)studioFail(404,'MEDIA_IMPORT_NOT_FOUND','未找到当前编辑的素材导入。');
    if(row.state==='rejected')studioFail(409,'MEDIA_IMPORT_REJECTED','这份文件未通过检查，请修正后重新导入。');
    if(row.state==='awaiting'&&Date.parse(row.expires_at)<=now())studioFail(409,'MEDIA_IMPORT_EXPIRED','导入已超过 24 小时，请重新选择文件并建立导入。');
    return row;
  }
  return {
    async list(p:StudioPrincipal){await auth.current(db,p,[...roles]);return {items:(await db.query<Row>('SELECT * FROM studio_media ORDER BY created_at DESC,id DESC LIMIT 100')).rows.map(publicRow)};},
    async begin(p:StudioPrincipal,raw:unknown,key:string){
      const input=mediaImportSchema.parse(raw);z.uuid().parse(key);const requestHash=digest(canonical(input));
      return db.transaction(async tx=>{
        await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');await auth.current(tx,p,['editor']);
        const prior=(await tx.query<Row>('SELECT * FROM studio_media WHERE actor=$1 AND request_key=$2',[p.id,key])).rows[0];
        if(prior){if(prior.request_hash!==requestHash)studioFail(409,'STUDIO_REQUEST_CONFLICT','导入重试的文件或说明已改变。');return publicRow(prior);}
        const count=(await tx.query<{total:number;pending:number}>('SELECT count(*)::int AS total,count(*) FILTER(WHERE actor=$1 AND state=\'awaiting\' AND expires_at>$2)::int AS pending FROM studio_media',[p.id,new Date(now()).toISOString()])).rows[0];
        if(count.total>=1000||count.pending>=20)studioFail(429,'MEDIA_LIBRARY_LIMIT','本地素材库或未完成导入已达到上限，请联系团队管理人员。');
        const id=randomUUID(),at=new Date(now()).toISOString();
        await tx.query("INSERT INTO studio_media(id,actor,metadata,source_hash,source_bytes,state,created_at,expires_at,request_key,request_hash) VALUES($1,$2,$3,$4,$5,'awaiting',$6,$7,$8,$9)",[id,p.id,input.metadata,input.sourceHash,input.sourceBytes,at,new Date(now()+MEDIA_IMPORT_TTL_MS).toISOString(),key,requestHash]);
        await audit(tx,p,'media-import-started',{mediaId:id,sourceHash:input.sourceHash,kind:input.metadata.kind});
        return publicRow((await tx.query<Row>('SELECT * FROM studio_media WHERE id=$1',[id])).rows[0]);
      });
    },
    async authorizeUpload(p:StudioPrincipal,id:string){return own(db,p,id);},
    async finish(p:StudioPrincipal,id:string,bytes:Buffer,declaredMime:string){
      const before=await own(db,p,id);
      if(declaredMime!==mediaMime(before.metadata.kind))studioFail(415,'MEDIA_TYPE_MISMATCH','上传格式与素材用途不一致。');
      if(bytes.length!==before.source_bytes||bytesHash(bytes)!==before.source_hash)studioFail(409,'MEDIA_SOURCE_CHANGED','文件与建立导入时的摘要不一致，请重新选择原文件或建立新导入。');
      if(before.state==='ready')return publicRow(before);
      let checked:Awaited<ReturnType<typeof processMedia>>;
      try{checked=await processMedia(before.metadata.kind,bytes);}catch(error){
        // Temporary tool failures can retry the exact same input; invalid bytes are final for this import.
        if(error instanceof StudioError&&error.status===422)await db.transaction(async tx=>{
          await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');await auth.current(tx,p,['editor']);
          const current=await own(tx,p,id);if(current.state==='awaiting'){
            await tx.query("UPDATE studio_media SET state='rejected',rejection=$2 WHERE id=$1",[id,error.code]);await audit(tx,p,'media-import-rejected',{mediaId:id,code:error.code});
          }
        });throw error;
      }
      const hash=bytesHash(checked.body);
      return db.transaction(async tx=>{
        await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');const current=await own(tx,p,id);
        if(current.state==='ready')return publicRow(current);
        const existingSource=(await tx.query('SELECT hash FROM content_media_sources WHERE hash=$1',[before.source_hash])).rows.length>0;
        const existingObject=(await tx.query('SELECT hash FROM content_media_objects WHERE hash=$1',[hash])).rows.length>0;
        const stored=(await tx.query<{total:string}>('SELECT ((SELECT coalesce(sum(bytes),0) FROM content_media_sources)+(SELECT coalesce(sum(bytes),0) FROM content_media_objects))::text AS total')).rows[0];
        if(Number(stored.total)+(existingSource?0:bytes.length)+(existingObject?0:checked.body.length)>MEDIA_STORAGE_LIMIT)studioFail(413,'MEDIA_STORAGE_LIMIT','本地素材容量已达到 256 MB，请先安排归档与容量管理。');
        await tx.query('INSERT INTO content_media_sources(hash,bytes,body) VALUES($1,$2,$3) ON CONFLICT(hash) DO NOTHING',[before.source_hash,bytes.length,bytes]);
        await tx.query('INSERT INTO content_media_objects(hash,mime,bytes,body) VALUES($1,$2,$3,$4) ON CONFLICT(hash) DO NOTHING',[hash,checked.inspection.mime,checked.body.length,checked.body]);
        await tx.query("UPDATE studio_media SET state='ready',asset_hash=$2,asset_bytes=$3,inspection=$4 WHERE id=$1",[id,hash,checked.body.length,checked.inspection]);
        await audit(tx,p,'media-import-ready',{mediaId:id,sourceHash:before.source_hash,assetHash:hash,inspection:checked.inspection});
        return publicRow((await tx.query<Row>('SELECT * FROM studio_media WHERE id=$1',[id])).rows[0]);
      });
    },
  };
}
export async function importedAsset(tx:Queryable,id:string,slot:'characters'|'objects'|'guide'){
  const row=(await tx.query<Row>('SELECT * FROM studio_media WHERE id=$1',[id])).rows[0];
  if(!row||row.state!=='ready'||!row.asset_hash||!row.inspection||row.metadata.kind!==slot)studioFail(422,'MEDIA_NOT_READY','请选择用途相符、检查通过的素材。');
  const metadata=row.metadata,hash=row.asset_hash!,inspection=row.inspection!;
  return {row,asset:{id:slot,path:mediaPath(hash,inspection.mime),sha256:hash,bytes:row.asset_bytes!,mime:inspection.mime,review:'unreviewed' as const,provenance:`studio:${row.id}; source:${row.source_hash}; metadata:${digest(canonical(metadata))}; rights declaration recorded; professional review pending`,...(metadata.kind==='guide'?{transcript:metadata.transcript,voice:metadata.voice,locale:metadata.locale}:{})}};
}
