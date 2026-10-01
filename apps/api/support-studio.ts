import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical, hashObject } from '../../packages/content/index.ts';
import { familyPackSchema,contentHashSchema,reviewScopes,sectionIds,reviewedFamilyPack,verifyFamilyRelease } from '../../packages/family-support/publication.ts';
import type { FamilyPack,FamilyRelease } from '../../packages/family-support/publication.ts';
import type { Database,Queryable } from './database.ts';
import type { LocalContent } from './content.ts';
import { registerFamilyRelease } from './family-content.ts';
import { studioFail,digest } from './studio-auth.ts';
import type { StudioAuth,StudioPrincipal,StudioRole } from './studio-auth.ts';

const roles:StudioRole[]=['editor','method-reviewer','language-reviewer','publisher'];
const note=z.string().trim().min(20).max(700);
const createSchema=z.object({sourceHash:contentHashSchema,version:familyPackSchema.shape.version}).strict();
const reviewSchema=z.object({scope:z.enum(reviewScopes),decision:z.enum(['approve','changes']),note,sections:z.array(z.string()).max(13),checks:z.object({ageAppropriate:z.boolean(),choiceAndRest:z.boolean(),claims:z.boolean(),language:z.boolean()}).strict()}).strict();
export interface SupportDraft {id:string;author:string;source_hash:string;pack:FamilyPack;version:number;round:number;state:string;candidate_hash:string|null;published_hash:string|null;created_at:string;updated_at:string}
export function supportStudio(db:Database,content:LocalContent,auth:StudioAuth,now:()=>number=Date.now){
  async function detail(id:string){
    const draft=(await db.query<SupportDraft>('SELECT * FROM support_drafts WHERE id=$1',[id])).rows[0];if(!draft)studioFail(404,'STUDIO_DRAFT_NOT_FOUND','未找到家庭内容稿件。');
    const source=(await db.query<{envelope:FamilyRelease}>('SELECT envelope FROM family_content_releases WHERE hash=$1',[draft!.source_hash])).rows[0].envelope.body.pack;
    const reviews=(await db.query('SELECT r.*,u.name FROM support_reviews r JOIN studio_users u ON u.id=r.reviewer WHERE draft_id=$1 ORDER BY created_at,id',[id])).rows;
    const history=(await db.query('SELECT a.action,a.at,a.detail,u.name FROM support_audit a JOIN studio_users u ON u.id=a.actor WHERE draft_id=$1 ORDER BY at,a.id',[id])).rows;
    return {draft:draft!,source,reviews,history};
  }
  async function audit(tx:Queryable,p:StudioPrincipal,id:string,action:string,detail:unknown){await tx.query('INSERT INTO support_audit VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,p.id,action,new Date(now()).toISOString(),detail]);}
  async function freeVersion(tx:Queryable,pack:FamilyPack){if((await tx.query('SELECT hash FROM family_content_releases WHERE pack_id=$1 AND version=$2',[pack.id,pack.version])).rows.length)studioFail(409,'STUDIO_VERSION_EXISTS','此版本已发布，请使用新的版本号。');}
  async function mutate(p:StudioPrincipal,id:string|null,action:string,input:unknown,match:unknown,key:string,allowed:StudioRole[],sensitive:boolean,run:(tx:Queryable,d:SupportDraft|null)=>Promise<string>){
    z.uuid().parse(key);if(id)z.uuid().parse(id);const requestHash=digest(canonical({id,action,input,match:match??null}));
    let saved:string;
    try{saved=await db.transaction(async tx=>{
      await tx.query('SELECT id FROM studio_write_guard WHERE id=1 FOR UPDATE');
      const fresh=await auth.current(tx,p,allowed,sensitive);if(fresh.role!==p.role)studioFail(403,'STUDIO_ROLE_REQUIRED','身份职责已变化，请重新登录。');
      await tx.query('SELECT id FROM studio_users WHERE id=$1 FOR UPDATE',[p.id]);
      const prior=(await tx.query<{request_hash:string;draft_id:string}>('SELECT request_hash,draft_id FROM support_commands WHERE actor=$1 AND request_key=$2',[p.id,key])).rows[0];
      if(prior){if(prior.request_hash!==requestHash)studioFail(409,'STUDIO_REQUEST_CONFLICT','重试请求内容不同。');return prior.draft_id;}
      const d=id?(await tx.query<SupportDraft>('SELECT * FROM support_drafts WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
      if(id&&!d)studioFail(404,'STUDIO_DRAFT_NOT_FOUND','未找到家庭内容稿件。');
      if(d){if(match===undefined)studioFail(428,'STUDIO_PRECONDITION_REQUIRED','请读取当前稿件。');if(match!==`"${d.version}"`)studioFail(409,'STUDIO_CONFLICT','稿件已更新，请重新读取。');}
      const result=await run(tx,d);await tx.query('INSERT INTO support_commands VALUES($1,$2,$3,$4)',[p.id,key,requestHash,result]);return result;
    });}catch(e){if((e as {code?:string}).code==='23505')studioFail(409,'STUDIO_VERSION_EXISTS','版本或本轮审阅已经存在，请刷新后查看。');throw e;}
    return detail(saved!);
  }
  async function update(tx:Queryable,d:SupportDraft,patch:Partial<Pick<SupportDraft,'pack'|'state'|'round'|'candidate_hash'|'published_hash'>>){
    const v={...d,...patch};await tx.query('UPDATE support_drafts SET pack=$2,state=$3,round=$4,candidate_hash=$5,published_hash=$6,version=version+1,updated_at=$7 WHERE id=$1',[d.id,v.pack,v.state,v.round,v.candidate_hash,v.published_hash,new Date(now()).toISOString()]);
  }
  return {
    async list(p:StudioPrincipal){await auth.current(db,p,roles);return {drafts:(await db.query("SELECT id,version,state,round,pack->>'version' AS content_version,pack->>'ageBand' AS age_band,updated_at FROM support_drafts ORDER BY updated_at DESC,id DESC LIMIT 100")).rows,releases:(await db.query("SELECT hash,pack_id,version,state,envelope->'body'->>'channel' AS channel,envelope->'body'->'pack'->>'ageBand' AS age_band FROM family_content_releases ORDER BY pack_id,version LIMIT 300")).rows};},
    async get(p:StudioPrincipal,id:string){await auth.current(db,p,roles);z.uuid().parse(id);return detail(id);},
    async create(p:StudioPrincipal,raw:unknown,key:string){const input=createSchema.parse(raw);return mutate(p,null,'create',input,undefined,key,['editor'],false,async tx=>{
      const src=await content.family.get(input.sourceHash,tx,true);content.family.requireAvailable(src.info);
      const pack=familyPackSchema.parse({...src.pack,version:input.version,review:'unreviewed',templates:src.pack.templates.map(t=>({...t,version:input.version,review:'unreviewed'}))});await freeVersion(tx,pack);
      const id=randomUUID(),at=new Date(now()).toISOString();await tx.query("INSERT INTO support_drafts(id,author,source_hash,pack,state,created_at,updated_at) VALUES($1,$2,$3,$4,'draft',$5,$5)",[id,p.id,input.sourceHash,pack,at]);await audit(tx,p,id,'created',{sourceHash:input.sourceHash});return id;
    });},
    async edit(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const pack=familyPackSchema.parse(raw);return mutate(p,id,'edit',pack,match,key,['editor'],false,async(tx,draft)=>{
      const d=draft!;if(d.author!==p.id||!['draft','changes-requested'].includes(d.state))studioFail(403,'STUDIO_EDIT_LOCKED','只有原作者可以修改可编辑稿件。');
      if(pack.id!==d.pack.id||pack.ageBand!==d.pack.ageBand||pack.review!=='unreviewed')studioFail(422,'STUDIO_CONTENT_CHANGED','不能更改适用年龄或自行标记审核通过。');
      await freeVersion(tx,pack);await update(tx,d,{pack,state:'draft',round:d.round+1,candidate_hash:null});await audit(tx,p,id,'edited',{round:d.round+1,hash:await hashObject(pack)});return id;
    });},
    async submit(p:StudioPrincipal,id:string,match:unknown,key:string){return mutate(p,id,'submit',{},match,key,['editor'],false,async(tx,draft)=>{
      const d=draft!;if(d.author!==p.id||d.state!=='draft')studioFail(409,'STUDIO_SUBMIT_LOCKED','当前稿件不能提交。');await freeVersion(tx,d.pack);
      const hash=await hashObject(reviewedFamilyPack(d.pack));await update(tx,d,{state:'in-review',candidate_hash:hash});await audit(tx,p,id,'submitted',{round:d.round,hash});return id;
    });},
    async reopen(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=z.object({reason:note}).strict().parse(raw);return mutate(p,id,'reopen',input,match,key,['editor'],false,async(tx,draft)=>{
      const d=draft!;if(d.author!==p.id||!['in-review','ready'].includes(d.state))studioFail(409,'STUDIO_EDIT_LOCKED','只有原作者可以撤回未发布的稿件。');await update(tx,d,{state:'draft',round:d.round+1,candidate_hash:null});await audit(tx,p,id,'reopened',input);return id;
    });},
    async review(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=reviewSchema.parse(raw);return mutate(p,id,'review',input,match,key,['method-reviewer','language-reviewer'],true,async(tx,draft)=>{
      const d=draft!;if(d.author===p.id||d.state!=='in-review'||!d.candidate_hash||(input.scope==='method')!==(p.role==='method-reviewer'))studioFail(409,'STUDIO_REVIEW_LOCKED','此人员或稿件状态不能执行所选审阅。');
      if(input.decision==='approve'&&(!Object.values(input.checks).every(Boolean)||input.sections.length!==13||!sectionIds.every(s=>input.sections.includes(s))))studioFail(422,'STUDIO_CHECKS_REQUIRED','通过前须逐项阅读九课和四个模板，并完成检查。');
      const hash=await hashObject(reviewedFamilyPack(d.pack));if(hash!==d.candidate_hash)studioFail(409,'STUDIO_CONTENT_CHANGED','候选版本已变化。');
      let approval:FamilyRelease['body']['approvals'][number]|null=null;
      if(input.decision==='approve'){const body:FamilyRelease['body']['approvals'][number]['body']={domain:'family-support-approval-1',packHash:hash,reviewer:p.id,scope:input.scope,approvedAt:new Date(now()).toISOString(),evidence:input.note,sections:sectionIds};approval={body,signature:await auth.sign(p,body)};}
      await tx.query('INSERT INTO support_reviews VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[randomUUID(),id,d.round,p.id,input.scope,input.decision,hash,input.note,{...input.checks,sections:input.sections},approval,new Date(now()).toISOString()]);
      const count=(await tx.query<{n:number}>("SELECT count(*)::int n FROM support_reviews WHERE draft_id=$1 AND round=$2 AND decision='approve'",[id,d.round])).rows[0].n;
      await update(tx,d,{state:input.decision==='changes'?'changes-requested':count===3?'ready':'in-review'});await audit(tx,p,id,'reviewed',{scope:input.scope,decision:input.decision,round:d.round,hash});return id;
    });},
    async publish(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=z.object({confirmHash:contentHashSchema,days:z.number().int().min(1).max(30)}).strict().parse(raw);return mutate(p,id,'publish',input,match,key,['publisher'],true,async(tx,draft)=>{
      const d=draft!;if(d.state!=='ready'||d.author===p.id||d.candidate_hash!==input.confirmHash)studioFail(409,'STUDIO_PUBLISH_LOCKED','请核对三项独立审阅和当前候选摘要。');
      const reviews=(await tx.query<{approval:FamilyRelease['body']['approvals'][number];enabled:boolean;role:StudioRole;scope:string}>("SELECT r.approval,u.enabled,u.role,r.scope FROM support_reviews r JOIN studio_users u ON u.id=r.reviewer WHERE draft_id=$1 AND round=$2 AND decision='approve' FOR SHARE OF u",[id,d.round])).rows;
      if(reviews.length!==3||reviews.some(r=>!r.enabled||r.role!==(r.scope==='method'?'method-reviewer':'language-reviewer')))studioFail(409,'STUDIO_REVIEWER_UNAVAILABLE','三个有效独立审阅尚未齐备，或审阅账号已变更。');
      const pack=reviewedFamilyPack(d.pack);await freeVersion(tx,pack);
      const body:FamilyRelease['body']={domain:'family-support-release-1',pack,packHash:await hashObject(pack),author:d.author,publisher:p.id,channel:'reviewed-preview',market:'LOCAL',issuedAt:new Date(now()).toISOString(),expiresAt:new Date(now()+input.days*86400000).toISOString(),approvals:reviews.map(r=>r.approval)};
      if(body.packHash!==d.candidate_hash)studioFail(409,'STUDIO_CONTENT_CHANGED','发布内容与审阅版本不同。');
      const release={body,signature:await auth.sign(p,body)};await verifyFamilyRelease(release,await content.trust(tx),{mode:'local',now:now()});await registerFamilyRelease(tx,release,await content.trust(tx),now());
      await tx.query('INSERT INTO family_content_channels VALUES($1,$2) ON CONFLICT(age_band) DO UPDATE SET hash=excluded.hash',[pack.ageBand,body.packHash]);
      await update(tx,d,{state:'published',published_hash:body.packHash});await audit(tx,p,id,'published',{hash:body.packHash,expiresAt:body.expiresAt});return id;
    });},
    async recall(p:StudioPrincipal,id:string,raw:unknown,match:unknown,key:string){const input=z.object({confirmHash:contentHashSchema,reason:note}).strict().parse(raw);return mutate(p,id,'recall',input,match,key,['publisher'],true,async(tx,draft)=>{
      const d=draft!;if(d.state!=='published'||d.published_hash!==input.confirmHash)studioFail(409,'STUDIO_RECALL_LOCKED','请核对已发布版本。');
      await tx.query("UPDATE family_content_releases SET state='recalled',recalled_at=$2,reason=$3 WHERE hash=$1",[input.confirmHash,new Date(now()).toISOString(),input.reason]);
      await update(tx,d,{state:'recalled'});await audit(tx,p,id,'recalled',input);return id;
    });},
  };
}
