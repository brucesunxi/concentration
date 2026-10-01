import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {canonical,hashObject,packSchema,verifyAsset} from '../../packages/content/index.ts';
import type {ContentPack} from '../../packages/content/index.ts';
import type {CandidatePreview,PreviewReceipt} from '../../packages/content/preview.ts';
import {createPlan,DAILY_LIMIT,replay,metrics} from '../../packages/task-engine/index.ts';
import type {Plan} from '../../packages/task-engine/index.ts';
import {environmentSchema,eventSchema} from '../../packages/contracts/index.ts';
import type {Database,Queryable} from './database.ts';
import type {LocalContent} from './content.ts';
import {studioFail,digest} from './studio-auth.ts';
import type {StudioAuth,StudioPrincipal} from './studio-auth.ts';
const roles=['editor','method-reviewer','language-reviewer','publisher'] as const;
const startSchema=z.object({confirmHash:z.string().regex(/^[a-f0-9]{64}$/),level:z.number().int().min(1).max(3),seed:z.string().trim().min(1).max(80),environment:environmentSchema.extend({platform:z.literal('web')})}).strict();
const finishSchema=z.object({events:z.array(eventSchema).min(1).max(1000)}).strict();
interface PreviewRow {id:string;actor:string;draft_id:string;round:number;pack_hash:string;pack:ContentPack;plan:Plan;plan_hash:string;budget_ms:number;created_at:string;expires_at:string;receipt:PreviewReceipt|null;request_hash:string}
export function candidatePack(pack:ContentPack){return packSchema.parse({...pack,review:'approved',assets:pack.assets.map(a=>({...a,review:'approved'}))});}
async function currentDraft(tx:Queryable,id:string,round?:number,hash?:string){
  const d=(await tx.query<{id:string;pack:ContentPack;round:number;state:string;candidate_hash:string;version:number}>('SELECT id,pack,round,state,candidate_hash,version FROM studio_drafts WHERE id=$1 FOR SHARE',[id])).rows[0];
  if(!d||!['in-review','ready','published'].includes(d.state)||!d.candidate_hash||(round!==undefined&&d.round!==round)||(hash!==undefined&&d.candidate_hash!==hash))studioFail(409,'STUDIO_PREVIEW_STALE','这一稿已变更、退回或召回。请返回工作台重新核对。');
  if(await hashObject(candidatePack(d.pack))!==d.candidate_hash)studioFail(409,'STUDIO_CONTENT_CHANGED','候选内容摘要不一致。');
  return d;
}
const publicPreview=(r:PreviewRow):CandidatePreview=>({id:r.id,actorId:r.actor,draftId:r.draft_id,round:r.round,packHash:r.pack_hash,pack:r.pack,plan:r.plan,planHash:r.plan_hash,budgetMs:r.budget_ms,createdAt:r.created_at,expiresAt:r.expires_at,receipt:r.receipt});
export function studioPreview(db:Database,content:LocalContent,auth:StudioAuth,now=Date.now){
  async function own(tx:Queryable,p:StudioPrincipal,id:string,lock=false){z.uuid().parse(id);const r=(await tx.query<PreviewRow>(`SELECT * FROM studio_previews WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0];if(!r||r.actor!==p.id)studioFail(404,'STUDIO_PREVIEW_NOT_FOUND','未找到当前身份的试玩。');await currentDraft(tx,r.draft_id,r.round,r.pack_hash);return r;}
  const unexpired=(r:PreviewRow)=>{if(Date.parse(r.expires_at)<=now())studioFail(409,'STUDIO_PREVIEW_EXPIRED','试玩窗口已结束，请返回工作台准备新的试玩。');};
  return {
    async start(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){
      z.uuid().parse(id);z.uuid().parse(key);const input=startSchema.parse(raw),requestHash=digest(canonical({id,input,match:match??null}));
      return db.transaction(async tx=>{
        await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');await auth.current(tx,p,[...roles]);
        const prior=(await tx.query<PreviewRow>('SELECT * FROM studio_previews WHERE actor=$1 AND request_key=$2',[p.id,key])).rows[0];
        if(prior){if(prior.request_hash!==requestHash)studioFail(409,'STUDIO_REQUEST_CONFLICT','重复请求的内容不同。');await currentDraft(tx,id,prior.round,prior.pack_hash);if(!prior.receipt)unexpired(prior);return publicPreview(prior);}
        const d=await currentDraft(tx,id);if(match!==`"${d.version}"`)studioFail(409,'STUDIO_CONFLICT','稿件已更新，请重新读取后试玩。');
        if(input.confirmHash!==d.candidate_hash)studioFail(409,'STUDIO_CONTENT_CHANGED','请核对当前冻结内容摘要。');
        const pack=candidatePack(d.pack);for(const a of pack.assets){const m=await content.readMedia(a.path,false,tx);if(!m)studioFail(422,'STUDIO_ASSET_MISSING','试玩素材尚未准备好。');await verifyAsset(a,new Uint8Array(m!.body));}
        const runId=randomUUID(),created=new Date(now()).toISOString(),expires=new Date(now()+30*60000).toISOString();
        const plan=createPlan({id:runId,task:pack.task,ageBand:pack.ageBand,locale:pack.locale,level:input.level,seed:input.seed,environment:input.environment,content:{id:pack.id,version:pack.version,sha256:d.candidate_hash}});
        const planHash=await hashObject(plan),budget=DAILY_LIMIT[pack.ageBand];
        await tx.query('INSERT INTO studio_previews(id,actor,draft_id,round,pack_hash,pack,plan,plan_hash,budget_ms,created_at,expires_at,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[runId,p.id,id,d.round,d.candidate_hash,pack,plan,planHash,budget,created,expires,key,requestHash]);
        await tx.query('INSERT INTO studio_audit VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,p.id,'preview-started',created,{previewId:runId,packHash:d.candidate_hash,round:d.round,level:input.level,seed:input.seed,input:input.environment.input}]);
        return publicPreview((await tx.query<PreviewRow>('SELECT * FROM studio_previews WHERE id=$1',[runId])).rows[0]);
      });
    },
    async get(p:StudioPrincipal,id:string){return db.transaction(async tx=>{await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');await auth.current(tx,p,[...roles]);const r=await own(tx,p,id);if(!r.receipt)unexpired(r);return publicPreview(r);});},
    async finish(p:StudioPrincipal,id:string,raw:unknown){
      const input=finishSchema.parse(raw),eventHash=await hashObject(input.events);
      return db.transaction(async tx=>{
        await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');await auth.current(tx,p,[...roles]);const r=await own(tx,p,id,true);
        if(r.receipt){if(r.receipt.eventHash!==eventHash)studioFail(409,'STUDIO_PREVIEW_CONFLICT','已核对的试玩记录不能替换。');return r.receipt;}
        unexpired(r);if(await hashObject(r.plan)!==r.plan_hash||r.plan.content?.sha256!==r.pack_hash)studioFail(409,'STUDIO_CONTENT_CHANGED','试玩计划摘要不一致。');
        const state=replay(r.plan,input.events,r.budget_ms);if(!state.ended)studioFail(422,'STUDIO_PREVIEW_UNFINISHED','先结束试玩，再核对记录。');
        const receipt:PreviewReceipt={id:r.id,complete:state.endReason==='completed',packHash:r.pack_hash,planHash:r.plan_hash,eventHash,completedAt:new Date(now()).toISOString(),formalTrials:state.results.filter(t=>!t.practice).length,independentTrials:metrics(state.results).trials,interruptions:state.interruptions,invalidations:state.invalidations.length,activeMs:state.activeMs};
        await tx.query('UPDATE studio_previews SET receipt=$2,events=$3 WHERE id=$1',[id,receipt,input.events]);
        await tx.query('INSERT INTO studio_audit VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),r.draft_id,p.id,'preview-finished',receipt.completedAt,{previewId:id,packHash:r.pack_hash,round:r.round,complete:receipt.complete,eventHash}]);return receipt;
      });
    },
  };
}

export async function requirePreview(tx:Queryable,actor:string,draftId:string,round:number,hash:string,id?:string){
  const r=id?(await tx.query<PreviewRow>('SELECT * FROM studio_previews WHERE id=$1 AND actor=$2 AND draft_id=$3 AND round=$4 AND pack_hash=$5',[id,actor,draftId,round,hash])).rows[0]:undefined;
  if(!r?.receipt?.complete)studioFail(422,'STUDIO_PREVIEW_REQUIRED','通过前请用当前身份完成这一稿的试玩，并选择该记录。');
  return r!.receipt!;
}
