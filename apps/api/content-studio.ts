import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical, hashObject, packSchema, verifyAsset } from '../../packages/content/index.ts';
import type { ContentPack, Release } from '../../packages/content/index.ts';
import type { Database, Queryable } from './database.ts';
import type { LocalContent } from './content.ts';
import {importedAsset} from './studio-media.ts';
import {candidatePack,requirePreview} from './studio-preview.ts';
import { registerReleaseInTransaction } from './content-registry.ts';
import { studioFail, digest } from './studio-auth.ts';
import type { StudioAuth, StudioPrincipal, StudioRole } from './studio-auth.ts';

const roles:StudioRole[]=['editor','method-reviewer','language-reviewer','publisher'];
const hash=z.string().regex(/^[a-f0-9]{64}$/),version=packSchema.shape.version;
const createSchema=z.object({sourceHash:hash,version}).strict();
const patchSchema=z.object({version,copy:packSchema.shape.copy,removeAudio:z.boolean()}).strict();
const note=z.string().trim().min(20).max(700);
const reviewSchema=z.object({previewId:z.uuid().optional(),decision:z.enum(['approve','changes']),note,checks:z.object({instructions:z.boolean(),ageAndLanguage:z.boolean(),assets:z.boolean(),claims:z.boolean()}).strict(),audioReviewedHashes:z.array(hash).max(20).optional()}).strict();
const publishSchema=z.object({confirmHash:hash,days:z.number().int().min(1).max(30)}).strict();
const recallSchema=z.object({confirmHash:hash,reason:z.string().trim().min(10).max(500)}).strict();
interface Draft {id:string;author:string;source_hash:string;pack:ContentPack;version:number;round:number;state:string;candidate_hash:string|null;published_hash:string|null;created_at:string;updated_at:string}
/** Approvals bind the exact prospective release, including its final approval markers. */
export const reviewedCandidate=candidatePack;
function audioHashes(pack:ContentPack){return pack.assets.filter(asset=>asset.mime==='audio/mpeg').map(asset=>asset.sha256).sort();}
function reviewedExactAudio(pack:ContentPack,raw:unknown){
  const expected=audioHashes(pack);
  if(expected.length===0&&raw===undefined)return true;
  if(!Array.isArray(raw)||raw.length!==expected.length||new Set(raw).size!==raw.length)return false;
  return raw.every((value,index)=>typeof value==='string'&&value===expected[index]);
}
export function contentStudio(db:Database,content:LocalContent,auth:StudioAuth,now:()=>number=Date.now){
  async function assets(pack:ContentPack,tx:Queryable){for(const asset of pack.assets){const media=await content.readMedia(asset.path,false,tx);if(!media)studioFail(422,'STUDIO_ASSET_MISSING','素材尚未入库，不能提交或发布。');await verifyAsset(asset,new Uint8Array(media!.body));}}
  async function audit(tx:Queryable,p:StudioPrincipal,id:string,action:string,detail:unknown){await tx.query('INSERT INTO studio_audit VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,p.id,action,new Date(now()).toISOString(),detail]);}
  async function draft(tx:Queryable,id:string){z.uuid().parse(id);const row=(await tx.query<Draft>('SELECT * FROM studio_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)studioFail(404,'STUDIO_DRAFT_NOT_FOUND','未找到内容草稿。');return row!;}
  async function freeVersion(tx:Queryable,pack:ContentPack){if((await tx.query('SELECT hash FROM content_releases WHERE pack_id=$1 AND version=$2',[pack.id,pack.version])).rows.length)studioFail(409,'STUDIO_VERSION_EXISTS','这个版本已发布，请填写新的版本号。');}
  async function detail(id:string){
    const row=(await db.query<Draft>('SELECT * FROM studio_drafts WHERE id=$1',[id])).rows[0];if(!row)studioFail(404,'STUDIO_DRAFT_NOT_FOUND','未找到内容草稿。');
    const source=(await db.query<{envelope:Release}>('SELECT envelope FROM content_releases WHERE hash=$1',[row!.source_hash])).rows[0].envelope.body.pack;
    const reviews=(await db.query('SELECT r.id,r.round,r.role,r.decision,r.pack_hash,r.preview_id,r.note,r.checks,r.approval,r.created_at,u.name FROM studio_reviews r JOIN studio_users u ON u.id=r.reviewer WHERE draft_id=$1 ORDER BY r.created_at,r.id',[id])).rows;
    const history=(await db.query('SELECT a.action,a.at,a.detail,u.name FROM studio_audit a JOIN studio_users u ON u.id=a.actor WHERE draft_id=$1 ORDER BY a.at,a.id',[id])).rows;
    const previews=(await db.query('SELECT id,actor,round,pack_hash,plan_hash,plan->>\'level\' AS level,plan->>\'seed\' AS seed,plan->\'environment\' AS environment,receipt,created_at,expires_at FROM studio_previews WHERE draft_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[id])).rows;
    const mediaIds=row!.pack.assets.flatMap(a=>{const match=a.provenance.match(/^studio:([a-f0-9-]{36});/);return match?[match[1]]:[];});
    const mediaSources=mediaIds.length?(await db.query('SELECT id,metadata,source_hash,inspection FROM studio_media WHERE id=ANY($1::uuid[])',[mediaIds])).rows:[];
    return {draft:row!,source,reviews,history,previews,mediaSources};
  }
  async function mutate(p:StudioPrincipal,id:string|null,action:string,input:unknown,match:unknown,key:string,allowed:StudioRole[],sensitive:boolean,run:(tx:Queryable,d:Draft|null)=>Promise<string>){
    z.uuid().parse(key);const requestHash=digest(canonical({id,action,input,match:match??null}));
    let savedId:string;
    try{savedId=await db.transaction(async tx=>{
      // Low-volume editorial writes share one ordered boundary. This avoids
      // reviewer/draft lock inversion during simultaneous approval/publication.
      await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');
      await auth.current(tx,p,allowed,sensitive);
      // Serialize retries from the same identity even when creating a new draft.
      await tx.query('SELECT id FROM studio_users WHERE id=$1 FOR UPDATE',[p.id]);
      const prior=(await tx.query<{request_hash:string;draft_id:string}>('SELECT request_hash,draft_id FROM studio_commands WHERE actor=$1 AND request_key=$2',[p.id,key])).rows[0];
      if(prior){if(prior.request_hash!==requestHash)studioFail(409,'STUDIO_REQUEST_CONFLICT','重复请求的内容不同，请重新查看。');return prior.draft_id;}
      const d=id?await draft(tx,id):null;
      if(d){if(match===undefined)studioFail(428,'STUDIO_PRECONDITION_REQUIRED','请先读取当前版本。');if(match!==`"${d.version}"`)studioFail(409,'STUDIO_CONFLICT','内容已被其他操作更新，请重新读取后再决定。');}
      const result=await run(tx,d);await tx.query('INSERT INTO studio_commands VALUES($1,$2,$3,$4)',[p.id,key,requestHash,result]);return result;
    });}catch(error){if((error as {code?:string}).code==='23505')studioFail(409,'STUDIO_VERSION_EXISTS','相同内容版本或审核记录已存在，请刷新后查看。');throw error;}
    return detail(savedId!);
  }
  async function update(tx:Queryable,d:Draft,fields:{state?:string;pack?:ContentPack;round?:number;candidate?:string|null;published?:string|null}){
    await tx.query('UPDATE studio_drafts SET pack=$2,state=$3,round=$4,candidate_hash=$5,published_hash=$6,version=version+1,updated_at=$7 WHERE id=$1',[d.id,fields.pack??d.pack,fields.state??d.state,fields.round??d.round,fields.candidate===undefined?d.candidate_hash:fields.candidate,fields.published===undefined?d.published_hash:fields.published,new Date(now()).toISOString()]);
  }
  return {
    async list(p:StudioPrincipal){await auth.current(db,p,roles);return {drafts:(await db.query("SELECT id,version,state,round,pack->>'version' AS content_version,pack->'copy'->>'title' AS title,pack->>'locale' AS locale,pack->>'ageBand' AS age_band,updated_at FROM studio_drafts ORDER BY updated_at DESC,id DESC LIMIT 100")).rows};},
    async catalogue(p:StudioPrincipal){await auth.current(db,p,roles);return {releases:(await db.query("SELECT hash,pack_id,version,state,envelope->'body'->>'channel' AS channel,envelope->'body'->'pack'->'copy'->>'title' AS title,envelope->'body'->'pack'->>'locale' AS locale,envelope->'body'->'pack'->>'ageBand' AS age_band FROM content_releases ORDER BY pack_id,version LIMIT 300")).rows};},
    async get(p:StudioPrincipal,id:string){await auth.current(db,p,roles);z.uuid().parse(id);return detail(id);},
    async create(p:StudioPrincipal,raw:unknown,key:string){const input=createSchema.parse(raw);return mutate(p,null,'create',input,undefined,key,['editor'],false,async tx=>{
      const source=(await tx.query<{envelope:Release;state:string}>('SELECT envelope,state FROM content_releases WHERE hash=$1 FOR SHARE',[input.sourceHash])).rows[0];if(!source||source.state!=='active')studioFail(409,'STUDIO_SOURCE_UNAVAILABLE','原内容已不可用，请重新选择。');
      const pack=packSchema.parse({...source!.envelope.body.pack,version:input.version,review:'unreviewed',assets:source!.envelope.body.pack.assets.map(a=>({...a,review:'unreviewed'}))});await freeVersion(tx,pack);
      const id=randomUUID(),at=new Date(now()).toISOString();await tx.query("INSERT INTO studio_drafts(id,author,source_hash,pack,state,created_at,updated_at) VALUES($1,$2,$3,$4,'draft',$5,$5)",[id,p.id,input.sourceHash,pack,at]);await audit(tx,p,id,'draft-created',{sourceHash:input.sourceHash,contentVersion:input.version});return id;
    });},
    async edit(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=patchSchema.parse(raw);return mutate(p,id,'edit',input,match,key,['editor'],false,async(tx,row)=>{
      const d=row!;if(d.author!==p.id||!['draft','changes-requested'].includes(d.state))studioFail(403,'STUDIO_EDIT_LOCKED','只有原作者可以修改草稿或被退回的内容。');
      const pack=structuredClone(d.pack);pack.version=input.version;pack.copy=input.copy;if(input.removeAudio&&pack.audio){pack.assets=pack.assets.filter(a=>a.id!==pack.audio!.assetId);delete pack.audio;}packSchema.parse(pack);await freeVersion(tx,pack);
      await update(tx,d,{pack,state:'draft',round:d.round+1,candidate:null});await audit(tx,p,id,'draft-edited',{previousHash:d.candidate_hash,round:d.round+1,changed:Object.keys(input.copy).filter(k=>input.copy[k as keyof typeof input.copy]!==d.pack.copy[k as keyof typeof input.copy]),audioRemoved:input.removeAudio});return id;
    });},
    async attach(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){
      const input=z.object({mediaId:z.uuid(),slot:z.enum(['characters','objects','guide'])}).strict().parse(raw);
      return mutate(p,id,'attach-media',input,match,key,['editor'],false,async(tx,row)=>{
        const d=row!;if(d.author!==p.id||!['draft','changes-requested'].includes(d.state))studioFail(403,'STUDIO_EDIT_LOCKED','只有原作者可以为可编辑稿件更换素材。');
        const {row:library,asset}=await importedAsset(tx,input.mediaId,input.slot),pack=structuredClone(d.pack);
        if(!library.metadata.ageBands.includes(pack.ageBand))studioFail(422,'MEDIA_AGE_MISMATCH','素材声明的适用年龄不包含这一稿。');
        if(input.slot==='guide'){
          const copyKey=pack.task==='stop'?'strategy':'rule';
          if(asset.locale!==pack.locale||asset.transcript!==pack.copy[copyKey])studioFail(422,'MEDIA_TRANSCRIPT_MISMATCH','语音语言与字幕必须逐字匹配本稿对应的规则或策略。');
          if(pack.audio)pack.assets=pack.assets.filter(a=>a.id!==pack.audio!.assetId);
          pack.audio={assetId:'guide',copyKey};
        }else if(!pack.assets.some(a=>a.id===input.slot&&a.mime==='image/png'))studioFail(422,'MEDIA_SLOT_MISMATCH','这一任务不使用所选图集，请选择实际使用的素材。');
        pack.assets=pack.assets.filter(a=>a.id!==input.slot);pack.assets.push(asset);packSchema.parse(pack);await freeVersion(tx,pack);await assets(pack,tx);
        await update(tx,d,{pack,state:'draft',round:d.round+1,candidate:null});
        await audit(tx,p,id,'draft-media-attached',{mediaId:input.mediaId,slot:input.slot,assetHash:asset.sha256,round:d.round+1});return id;
      });
    },
    async submit(p:StudioPrincipal,id:string,match:unknown,key:string){return mutate(p,id,'submit',{},match,key,['editor'],false,async(tx,row)=>{
      const d=row!;if(d.author!==p.id||d.state!=='draft')studioFail(409,'STUDIO_SUBMIT_LOCKED','当前版本不能提交审核。');await freeVersion(tx,d.pack);await assets(d.pack,tx);const candidate=await hashObject(reviewedCandidate(d.pack));await update(tx,d,{state:'in-review',candidate});await audit(tx,p,id,'submitted',{round:d.round,packHash:candidate});return id;
    });},
    async reopen(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=z.object({reason:note}).strict().parse(raw);return mutate(p,id,'reopen',input,match,key,['editor'],false,async(tx,row)=>{
      const d=row!;if(d.author!==p.id||!['in-review','ready'].includes(d.state))studioFail(409,'STUDIO_EDIT_LOCKED','只有原作者可以撤回未发布的稿件。');
      await update(tx,d,{state:'draft',round:d.round+1,candidate:null});await audit(tx,p,id,'draft-reopened',{round:d.round+1,previousHash:d.candidate_hash,reason:input.reason});return id;
    });},
    async review(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=reviewSchema.parse(raw);return mutate(p,id,'review',input,match,key,['method-reviewer','language-reviewer'],true,async(tx,row)=>{
      const d=row!;if(d.author===p.id||d.state!=='in-review'||!d.candidate_hash)studioFail(409,'STUDIO_REVIEW_LOCKED','此版本不能由当前人员审核。');
      if(input.decision==='approve'&&!Object.values(input.checks).every(Boolean))studioFail(422,'STUDIO_CHECKS_REQUIRED','通过前须逐项核对规则、适龄语言、素材与表述。');
      const reviewedHashes=[...(input.audioReviewedHashes??[])].sort();
      if(input.decision==='approve'&&!reviewedExactAudio(d.pack,reviewedHashes))studioFail(422,'STUDIO_AUDIO_REVIEW_REQUIRED','请完整试听并逐一确认当前版本的声音文件。');
      const packHash=await hashObject(reviewedCandidate(d.pack));if(packHash!==d.candidate_hash)studioFail(409,'STUDIO_CONTENT_CHANGED','审核内容摘要已变化。');
      let approval:Release['body']['approvals'][number]|null=null;
      if(input.decision==='approve'){const preview=await requirePreview(tx,p.id,id,d.round,packHash,input.previewId);const body={packHash,reviewer:p.id,role:p.role as 'method-reviewer'|'language-reviewer',approvedAt:new Date(now()).toISOString(),evidence:input.note+'\n试玩 '+preview.id+' · plan '+preview.planHash+' · events '+preview.eventHash+'\n声音文件 '+reviewedHashes.length+' · '+digest(canonical(reviewedHashes))};approval={body,signature:await auth.sign(p,body)};}
      await tx.query('INSERT INTO studio_reviews(id,draft_id,round,reviewer,role,decision,pack_hash,note,checks,approval,created_at,preview_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[randomUUID(),id,d.round,p.id,p.role,input.decision,packHash,input.note,{...input.checks,audioReviewedHashes:input.decision==='approve'?reviewedHashes:[]},approval,new Date(now()).toISOString(),input.decision==='approve'?input.previewId:null]);
      const count=(await tx.query<{n:number}>("SELECT count(*)::int AS n FROM studio_reviews WHERE draft_id=$1 AND round=$2 AND decision='approve'",[id,d.round])).rows[0].n;
      await update(tx,d,{state:input.decision==='changes'?'changes-requested':count===2?'ready':'in-review'});await audit(tx,p,id,input.decision==='changes'?'changes-requested':'review-approved',{round:d.round,role:p.role,packHash,note:input.note});return id;
    });},
    async publish(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=publishSchema.parse(raw);return mutate(p,id,'publish-preview',input,match,key,['publisher'],true,async(tx,row)=>{
      const d=row!;if(d.state!=='ready'||d.author===p.id||d.candidate_hash!==input.confirmHash)studioFail(409,'STUDIO_PUBLISH_LOCKED','请核对双审状态和当前内容摘要。');
      const reviews=(await tx.query<{approval:Release['body']['approvals'][number];enabled:boolean;preview_id:string;reviewer:string;checks:{audioReviewedHashes?:unknown}}>('SELECT r.approval,r.checks,u.enabled,r.preview_id,r.reviewer FROM studio_reviews r JOIN studio_users u ON u.id=r.reviewer WHERE r.draft_id=$1 AND r.round=$2 AND r.decision=\'approve\' FOR SHARE OF u',[id,d.round])).rows;
      if(reviews.length!==2||reviews.some(r=>!r.enabled))studioFail(409,'STUDIO_REVIEWER_UNAVAILABLE','两项有效审核尚未齐备，或审核身份已停用。');
      if(reviews.some(r=>!reviewedExactAudio(d.pack,r.checks?.audioReviewedHashes)))studioFail(409,'STUDIO_AUDIO_REVIEW_REQUIRED','旧审核缺少当前声音的逐文件确认，请开启新稿次重新审核。');
      for(const r of reviews)await requirePreview(tx,r.reviewer,id,d.round,d.candidate_hash!,r.preview_id);
      const pack=reviewedCandidate(d.pack);await assets(pack,tx);
      const body:Release['body']={pack,packHash:await hashObject(pack),author:d.author,publisher:p.id,channel:'reviewed-preview',markets:['LOCAL'],issuedAt:new Date(now()).toISOString(),expiresAt:new Date(now()+input.days*86400000).toISOString(),approvals:reviews.map(r=>r.approval)};
      if(body.packHash!==d.candidate_hash)studioFail(409,'STUDIO_CONTENT_CHANGED','发布内容摘要已变化。');
      const release:Release={body,signature:await auth.sign(p,body)};const registered=await registerReleaseInTransaction(tx,release,{mode:'local',market:'LOCAL',now:now()});
      const slot=`${pack.task}:${pack.ageBand}:${pack.locale}`;await tx.query('INSERT INTO content_channels VALUES($1,$2) ON CONFLICT(slot) DO UPDATE SET hash=excluded.hash',[slot,registered]);
      await update(tx,d,{state:'published',published:registered});await audit(tx,p,id,'preview-published',{hash:registered,channel:'reviewed-preview',slot,expiresAt:body.expiresAt});return id;
    });},
    async recall(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=recallSchema.parse(raw);const result=await mutate(p,id,'recall',input,match,key,['publisher'],true,async(tx,row)=>{
      const d=row!;if(!['published','recalled'].includes(d.state)||d.published_hash!==input.confirmHash)studioFail(409,'STUDIO_RECALL_LOCKED','请核对已发布版本的摘要。');
      const state=(await tx.query<{state:string}>('SELECT state FROM content_releases WHERE hash=$1 FOR UPDATE',[input.confirmHash])).rows[0];
      if(state.state!=='recalled'){await tx.query("UPDATE content_releases SET state='recalled',recalled_at=$2,reason=$3 WHERE hash=$1",[input.confirmHash,new Date(now()).toISOString(),input.reason]);await tx.query('INSERT INTO content_audit VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),input.confirmHash,'recalled',p.id,new Date(now()).toISOString(),input.reason]);}
      await update(tx,d,{state:'recalled'});await audit(tx,p,id,'preview-recalled',{hash:input.confirmHash,reason:input.reason});return id;
    });
      // A retried command also resumes cleanup after a server interruption.
      await content.recall(input.confirmHash,p.id,input.reason);return result;
    },
  };
}
