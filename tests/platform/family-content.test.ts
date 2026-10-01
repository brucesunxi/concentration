import { test } from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../../apps/api/database.ts';
import {createLocalContent} from '../../apps/api/content.ts';
import {initialFamilyPack} from '../../apps/api/family-content.ts';
import {familyPackSchema,verifyFamilyRelease,sectionIds} from '../../packages/family-support/publication.ts';
import type {FamilyRelease} from '../../packages/family-support/publication.ts';
import {signObject} from '../../packages/content/index.ts';
import {studioAuth,provisionStudioUser,totp} from '../../apps/api/studio-auth.ts';
import type {StudioVault,StudioSecret,StudioRole,StudioPrincipal} from '../../apps/api/studio-auth.ts';
import {supportStudio} from '../../apps/api/support-studio.ts';
import {service} from '../../apps/api/service.ts';
const rejected=(code:string)=>(e:unknown)=>(e as {code:string}).code===code;
const checks={ageAppropriate:true,choiceAndRest:true,claims:true,language:true};
const note='Synthetic automated review only. No professional approval or evidence of effectiveness is represented.';
const etag=(d:{draft:{version:number}})=>`"${d.draft.version}"`;
async function fixture(){
 const db=await openDatabase('memory://');await migrate(db);let clock=Date.parse('2026-10-01T02:00:00Z');const now=()=>clock;
 const secrets=new Map<string,StudioSecret>(),vault:StudioVault={async read(id){return secrets.get(id)!;},async write(id,s){secrets.set(id,s);}};
 const content=await createLocalContent(db,{now}),auth=studioAuth(db,vault,now),studio=supportStudio(db,content,auth,now),users={} as Record<string,StudioPrincipal>;
 for(const [login,role] of [['editor','editor'],['method','method-reviewer'],['chinese','language-reviewer'],['english','language-reviewer'],['publisher','publisher']] as [string,StudioRole][]){
  const u=await provisionStudioUser(db,vault,{login,name:'Synthetic '+login,role,password:'Synthetic-family-content-2026!'},now());
  const session=await auth.login({login,password:'Synthetic-family-content-2026!',code:totp(secrets.get(u.id)!.totp,now())});users[login]=(await auth.authenticate(session.value))!;
 }
 const api=service(db,now,content),setup=await api.setup({name:'Synthetic content '+randomUUID().slice(0,8),password:'Synthetic-family-2026!',locale:'en',timezone:'UTC',acknowledgedLocalUse:true});
 const parent=(await api.authenticate(setup.value))!,child=await api.addChild(parent,{alias:'Synthetic teen',ageBand:'12-14',locale:'en',localConfirmation:true});
 const source=(await content.family.current('12-14')).info.hash!;
 return {db,content,auth,studio,users,secrets,api,parent,child,source,now,advance:(ms:number)=>clock+=ms,close:()=>db.close()};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function draft(f:Fixture){let d=await f.studio.create(f.users.editor,{sourceHash:f.source,version:'99.0.0-test'},randomUUID());const pack=structuredClone(d.draft.pack);pack.templates[0].title.en='An edited synthetic activity';d=await f.studio.edit(f.users.editor,d.draft.id,pack,etag(d),randomUUID());return f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());}
async function reviewed(f:Fixture){let d=await draft(f);for(const [person,scope] of [['method','method'],['chinese','language:zh-CN'],['english','language:en']])d=await f.studio.review(f.users[person],d.draft.id,{scope,decision:'approve',note,checks,sections:sectionIds},etag(d),randomUUID());return d;}
async function published(f:Fixture){const d=await reviewed(f);return f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:1},etag(d),randomUUID());}

test('family pack structure fixes ages, all bilingual sections and task links',()=>{
 for(const age of ['6-8','9-11','12-14','15-17'] as const){const p=initialFamilyPack(age);assert.equal(p.lessons.length,9);assert.equal(p.templates.length,4);assert.ok(Buffer.byteLength(JSON.stringify(p))<65536);}
 for(const mutate of [(p:ReturnType<typeof initialFamilyPack>)=>p.lessons[1].task='memory',(p:ReturnType<typeof initialFamilyPack>)=>p.templates[0].ageBand='6-8',(p:ReturnType<typeof initialFamilyPack>)=>delete (p.lessons[0].title as Partial<typeof p.lessons[0]['title']>).en,(p:ReturnType<typeof initialFamilyPack>)=>p.lessons.reverse()]){const p=initialFamilyPack('12-14');mutate(p);assert.throws(()=>familyPackSchema.parse(p));}
});

test('family editorial commands enforce roles, versions, complete reading, separate languages and reviewer identities',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.studio.create(f.users.publisher,{sourceHash:f.source,version:'99.0.0-test'},randomUUID()),rejected('STUDIO_ROLE_REQUIRED'));
  let d=await draft(f);const input={scope:'method',decision:'approve',note,checks,sections:sectionIds};
  await assert.rejects(f.studio.review(f.users.chinese,d.draft.id,input,etag(d),randomUUID()),rejected('STUDIO_REVIEW_LOCKED'));
  await assert.rejects(f.studio.review(f.users.method,d.draft.id,{...input,sections:sectionIds.slice(1)},etag(d),randomUUID()),rejected('STUDIO_CHECKS_REQUIRED'));
  await assert.rejects(f.studio.review(f.users.method,d.draft.id,{...input,checks:{...checks,claims:false}},etag(d),randomUUID()),rejected('STUDIO_CHECKS_REQUIRED'));
  const key=randomUUID(),match=etag(d);d=await f.studio.review(f.users.method,d.draft.id,input,match,key);assert.equal((await f.studio.review(f.users.method,d.draft.id,input,match,key)).draft.version,d.draft.version);
  await assert.rejects(f.studio.review(f.users.method,d.draft.id,{...input,note:note+'changed'},match,key),rejected('STUDIO_REQUEST_CONFLICT'));
  await assert.rejects(f.studio.review(f.users.chinese,d.draft.id,{...input,scope:'language:zh-CN'},match,randomUUID()),rejected('STUDIO_CONFLICT'));
  d=await f.studio.review(f.users.chinese,d.draft.id,{...input,scope:'language:zh-CN'},etag(d),randomUUID());
  await assert.rejects(f.studio.review(f.users.chinese,d.draft.id,{...input,scope:'language:en'},etag(d),randomUUID()),rejected('STUDIO_VERSION_EXISTS'));
  await assert.rejects(f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:1},etag(d),randomUUID()),rejected('STUDIO_PUBLISH_LOCKED'));
  d=await f.studio.review(f.users.english,d.draft.id,{...input,scope:'language:en'},etag(d),randomUUID());assert.equal(d.draft.state,'ready');
  d=await f.studio.reopen(f.users.editor,d.draft.id,{reason:note},etag(d),randomUUID());assert.equal(d.draft.candidate_hash,null);assert.equal(d.draft.round,3);
  d=await f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());assert.equal(d.draft.state,'in-review');
 }finally{await f.close();}
});

test('publication verifies signatures, refuses production, tampering and disabled reviewers',async()=>{
 const f=await fixture();try{
  let d=await reviewed(f);await f.db.query('UPDATE studio_users SET enabled=false WHERE id=$1',[f.users.english.id]);
  await assert.rejects(f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:1},etag(d),randomUUID()),rejected('STUDIO_REVIEWER_UNAVAILABLE'));
  await f.db.query('UPDATE studio_users SET enabled=true WHERE id=$1',[f.users.english.id]);
  d=await f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:1},etag(d),randomUUID());
  const release=(await f.db.query<{envelope:FamilyRelease}>('SELECT envelope FROM family_content_releases WHERE hash=$1',[d.draft.published_hash])).rows[0].envelope,trust=await f.content.trust();
  assert.equal((await verifyFamilyRelease(release,trust,{mode:'local',now:f.now()})).review,'approved');
  await assert.rejects(verifyFamilyRelease(release,trust,{mode:'production',now:f.now()}),rejected('LOCAL_ONLY_CONTENT'));
  const tampered=structuredClone(release);tampered.body.pack.lessons[0].title.en='Tampered';await assert.rejects(verifyFamilyRelease(tampered,trust,{mode:'local',now:f.now()}),rejected('INVALID_SIGNATURE'));
  const missing=structuredClone(release);missing.body.approvals.pop();const key=await crypto.subtle.importKey('jwk',f.secrets.get(f.users.publisher.id)!.signingKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);missing.signature=await signObject(missing.body,'studio-'+f.users.publisher.id,key);
  await assert.rejects(verifyFamilyRelease(missing,trust,{mode:'local',now:f.now()}),rejected('THREE_REVIEWS_REQUIRED'));
  const other=structuredClone(release);other.body.domain='task-release' as never;await assert.rejects(verifyFamilyRelease(other,trust,{mode:'local',now:f.now()}));
 }finally{await f.close();}
});

test('new goals bind displayed releases, stale writes fail, recall stops use without losing historical or privacy actions',async()=>{
 const f=await fixture();try{
  const stale={intent:'suggest',templateId:'find',support:'ask-first',contentHash:f.source};
  await assert.rejects(f.api.createLifeGoal(f.parent,f.child.id,{intent:'suggest',templateId:'find',support:'space'},randomUUID()),rejected('FAMILY_CONTENT_UPDATE_REQUIRED'));
  const old=(await f.api.createLifeGoal(f.parent,f.child.id,stale,randomUUID())).goal;
  await f.api.actLifeGoal(f.parent,f.child.id,old.id,{action:'stop'},'"1"',randomUUID());
  const d=await published(f),hash=d.draft.published_hash!,guide=await f.api.parentGuide(f.parent,f.child.id);assert.equal(guide.content.hash,hash);assert.equal(guide.review,'approved');
  await assert.rejects(f.api.createLifeGoal(f.parent,f.child.id,stale,randomUUID()),rejected('FAMILY_CONTENT_CHANGED'));
  const enter=await f.api.enterChild(f.parent,f.child.id),cp=(await f.api.authenticate(enter.auth.value))!;
  const input={...stale,intent:'choose',contentHash:hash},reflected=(await f.api.createLifeGoal(cp,f.child.id,input,randomUUID())).goal;
  await f.api.actLifeGoal(cp,f.child.id,reflected.id,{action:'reflect',sharing:'family',reflection:{outcome:'tried',helpful:'yes',next:'rest'}},'"1"',randomUUID());
  const createKey=randomUUID(),active=(await f.api.createLifeGoal(cp,f.child.id,input,createKey)).goal;
  await f.studio.recall(f.users.publisher,d.draft.id,{confirmHash:hash,reason:note},etag(d),randomUUID());
  const history=await f.api.lifeSpace(cp,f.child.id);assert.equal(history.content.state,'recalled');assert.deepEqual(history.templates,[]);assert.equal(history.goals.length,3);assert.equal(history.goals.find(g=>g.id===old.id)!.contentHash,f.source);assert.equal(history.releases[hash].state,'recalled');
  assert.equal((await f.api.createLifeGoal(cp,f.child.id,input,createKey)).goal.id,active.id);
  await assert.rejects(f.api.actLifeGoal(cp,f.child.id,active.id,{action:'reflect',sharing:'none'},'"1"',randomUUID()),rejected('FAMILY_CONTENT_RECALLED'));
  assert.equal((await f.api.actLifeGoal(cp,f.child.id,reflected.id,{action:'unshare'},'"2"',randomUUID())).goal.reflection,null);
  await f.api.actLifeGoal(cp,f.child.id,active.id,{action:'stop'},'"1"',randomUUID());
  await assert.rejects(f.api.createLifeGoal(cp,f.child.id,input,randomUUID()),rejected('FAMILY_CONTENT_RECALLED'));
 }finally{await f.close();}
});

test('expired or corrupt selected releases fail closed, while legacy records remain explicit and readable',async()=>{
 const f=await fixture();try{
  const d=await published(f);const g=(await f.api.createLifeGoal(f.parent,f.child.id,{contentHash:d.draft.published_hash,intent:'suggest',templateId:'steps',support:'space'},randomUUID())).goal;
  await f.db.query('UPDATE life_goals SET content_hash=NULL WHERE id=$1',[g.id]);
  f.advance(86400001);
  // Refresh family credentials after their normal expiry; content expiry is independent.
  const auth=await f.api.login({name:(await f.db.query<{name:string}>('SELECT name FROM families WHERE id=$1',[f.parent.family_id])).rows[0].name,password:'Synthetic-family-2026!'}),p=(await f.api.authenticate(auth.value))!;
  await assert.rejects(f.api.parentGuide(p,f.child.id),rejected('FAMILY_CONTENT_EXPIRED'));
  let space=await f.api.lifeSpace(p,f.child.id);assert.equal(space.content.state,'expired');assert.equal(space.goals[0].contentHash,null);
  await f.api.actLifeGoal(p,f.child.id,g.id,{action:'stop'},'"1"',randomUUID());
  await f.db.query("UPDATE family_content_releases SET envelope=jsonb_set(envelope,'{body,pack,lessons,0,title,en}',to_jsonb('corrupt'::text)) WHERE hash=$1",[d.draft.published_hash]);
  space=await f.api.lifeSpace(p,f.child.id);assert.equal(space.content.state,'unavailable');assert.equal(space.total,1);assert.equal(space.templates.length,0);
  await assert.rejects(f.api.parentGuide(p,f.child.id),rejected('INVALID_SIGNATURE'));
 }finally{await f.close();}
});
