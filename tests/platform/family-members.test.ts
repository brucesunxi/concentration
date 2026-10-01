import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash, scryptSync } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { FamilyMembersClient } from '../../packages/session-runtime/family-members-client.ts';
import type { FamilyMembers } from '../../packages/contracts/family-members.ts';

let db:Database,api:FocusService,at=Date.now();
const denied=(code:string)=>(error:unknown)=>error instanceof ApiError&&error.code===code;
before(async()=>{db=await openDatabase('memory://');await migrate(db);api=service(db,()=>at);});
after(()=>db.close());
async function fixture(){
  const credentials={name:'Members-'+randomUUID().slice(0,8),password:'Synthetic-owner-passphrase!'};
  const auth=await api.setup({...credentials,timezone:'UTC',locale:'en',acknowledgedLocalUse:true});
  const owner=(await api.authenticate(auth.value))!;
  const a=await api.addChild(owner,{alias:'Selected',ageBand:'6-8',locale:'en',localConfirmation:true});
  const b=await api.addChild(owner,{alias:'Private sibling',ageBand:'15-17',locale:'en',localConfirmation:true});
  const invite=await api.inviteMember(owner,{childIds:[a.id],acknowledged:true},randomUUID());
  return {credentials,auth,owner,a,b,invite};
}
const memberInput=(code:string)=>({code,loginName:'caregiver',displayName:'Synthetic Parent',password:'Synthetic-helper-passphrase!',acknowledgedLocalUse:true});
async function joined(f:Awaited<ReturnType<typeof fixture>>,approve=true){
  const auth=await api.join(memberInput(f.invite.code));let p=(await api.authenticate(auth.value))!;
  if(approve){await api.actMember(f.owner,p.member_id,{action:'approve',acknowledged:true},'"1"');p=(await api.authenticate(auth.value))!;}
  return {auth,p};
}

test('invitation secrets are one-use, expiring, hashed and absent from lists, exports and audit',async()=>{
  const f=await fixture();assert.match(f.invite.code,/^[a-f0-9]{64}$/);
  const stored=(await db.query<{code_hash:string}>('SELECT code_hash FROM family_invitations WHERE id=$1',[f.invite.id])).rows[0];
  assert.equal(stored.code_hash,createHash('sha256').update(f.invite.code).digest('hex'));
  for(const value of [await api.familyMembers(f.owner),await api.exportChild(f.owner,f.a.id),(await db.query('SELECT * FROM family_member_audit WHERE family_id=$1',[f.owner.family_id])).rows])assert.ok(!JSON.stringify(value).includes(f.invite.code));
  await joined(f,false);await assert.rejects(api.join({...memberInput(f.invite.code),loginName:'another'}),denied('INVITE_UNAVAILABLE'));
  const g=await fixture();at+=48*3600000;
  await assert.rejects(api.join(memberInput(g.invite.code)),denied('INVITE_UNAVAILABLE'));
});

test('acceptance is pending with no child data until the creator confirms the same member version',async()=>{
  const f=await fixture(),m=await joined(f,false);
  assert.equal((await api.me(m.p)).member?.state,'pending');assert.deepEqual((await api.me(m.p)).children,[]);
  assert.equal((await api.familyMembers(m.p)).members.length,1);assert.deepEqual((await api.familyMembers(m.p)).invitations,[]);
  assert.ok(!JSON.stringify(await api.familyMembers(m.p)).includes(f.a.id));
  for(const action of [()=>api.report(m.p,f.a.id),()=>api.enterChild(m.p,f.a.id),()=>api.start(m.p,f.a.id,{task:'search',environment:TEST_ENVIRONMENT,deviceId:randomUUID()},randomUUID()),()=>api.parentGuide(m.p,f.a.id)])await assert.rejects(action(),denied('MEMBER_PENDING'));
  await assert.rejects(api.actMember(f.owner,m.p.member_id,{action:'approve',acknowledged:true},'"2"'),denied('MEMBER_VERSION_CONFLICT'));
  await api.actMember(f.owner,m.p.member_id,{action:'approve',acknowledged:true},'"1"');
  const p=(await api.authenticate(m.auth.value))!;assert.deepEqual((await api.me(p)).children.map(c=>c.id),[f.a.id]);
});

test('a support account sees only selected practice records and cannot expand access or read shared reflections',async()=>{
  const f=await fixture(),{p}=await joined(f);
  assert.equal((await api.me(p)).children[0].consentActive,true);
  assert.equal((await api.report(p,f.a.id)).child.id,f.a.id);assert.equal((await api.practiceLimits(p,f.a.id)).canEdit,false);
  for(const action of [()=>api.report(p,f.b.id),()=>api.enterChild(p,f.b.id),()=>api.parentGuide(p,f.b.id)])await assert.rejects(action(),denied('NOT_FOUND'));
  for(const action of [()=>api.addChild(p,{}),()=>api.inviteMember(p,{childIds:[f.a.id],acknowledged:true},randomUUID()),()=>api.exportChild(p,f.a.id),()=>api.deleteChild(p,f.a.id),()=>api.withdraw(p,f.a.id),()=>api.lifeSpace(p,f.a.id),()=>api.setPracticeLimit(p,f.a.id,{},'"1"')])await assert.rejects(action(),denied('OWNER_REQUIRED'));
  const other=await fixture();await assert.rejects(api.actMember(other.owner,p.member_id,{action:'revoke',acknowledged:true},'"2"'),denied('NOT_FOUND'));
  await assert.rejects(api.actMember(f.owner,f.owner.member_id,{action:'revoke',acknowledged:true},'"1"'),denied('OWNER_PROTECTED'));
});

test('revocation invalidates parent and derived child access immediately without changing another member or deleting records',async()=>{
  const f=await fixture(),m=await joined(f),other=await fixture();
  const native=await api.login({...f.credentials,password:memberInput('').password,memberLogin:'caregiver'},'native');
  const started=await api.start(m.p,f.a.id,{task:'search',environment:TEST_ENVIRONMENT,deviceId:randomUUID()},randomUUID());
  const cp=(await api.authenticate(started.auth.value))!;
  await api.actMember(f.owner,m.p.member_id,{action:'revoke',acknowledged:true},'"2"');
  assert.equal(await api.authenticate(native.value,'native'),null);assert.equal(await api.authenticate(started.auth.value),null);
  await assert.rejects(api.sessionStatus(cp,started.session.id),denied('UNAUTHENTICATED'));
  await assert.rejects(api.me(m.p),denied('UNAUTHENTICATED'));
  await assert.rejects(api.login({...f.credentials,password:memberInput('').password,memberLogin:'caregiver'}),denied('LOGIN_FAILED'));
  assert.ok(await api.authenticate(f.auth.value));assert.ok(await api.authenticate(other.auth.value));
  assert.equal((await api.recoverySpace(f.owner,f.a.id,{deviceId:started.session.device_id})).active?.id,started.session.id);
});

test('support password change and signout affect its own devices and leave the creator and children records intact',async()=>{
  const f=await fixture(),m=await joined(f);
  const native=await api.login({...f.credentials,password:memberInput('').password,memberLogin:'caregiver'},'native');
  await api.changePassword(m.p,{currentPassword:memberInput('').password,newPassword:'Another-helper-passphrase!',acknowledged:true});
  assert.equal(await api.authenticate(native.value,'native'),null);assert.ok(await api.authenticate(f.auth.value));
  const auth=await api.login({...f.credentials,password:'Another-helper-passphrase!',memberLogin:'caregiver'}),p=(await api.authenticate(auth.value))!;
  assert.equal((await api.accountSecurity(p)).memberRole,'support');assert.equal((await api.accountSecurity(p)).active.parent.web,1);
  await api.logoutAll(p,{currentPassword:'Another-helper-passphrase!',acknowledged:true});
  assert.ok(await api.authenticate(f.auth.value));assert.equal((await api.me(f.owner)).children.length,2);
});

test('invite cancellation, child collection withdrawal, stale approval and recent-auth boundaries fail safely',async()=>{
  const f=await fixture();await api.cancelInvitation(f.owner,f.invite.id,{acknowledged:true});
  await assert.rejects(api.join(memberInput(f.invite.code)),denied('INVITE_UNAVAILABLE'));
  const g=await fixture(),m=await joined(g,false);await api.withdraw(g.owner,g.a.id);
  await assert.rejects(api.actMember(g.owner,m.p.member_id,{action:'approve',acknowledged:true},'"1"'),denied('MEMBER_CHILDREN_UNAVAILABLE'));
  await api.actMember(g.owner,m.p.member_id,{action:'revoke',acknowledged:true},'"1"');
  const h=await fixture();at+=10*60000+1;
  await assert.rejects(api.inviteMember(h.owner,{childIds:[h.a.id],acknowledged:true},randomUUID()),denied('REAUTH_REQUIRED'));
});

test('duplicate request and concurrent acceptance cannot create an extra account or consume the wrong invitation',async()=>{
  const f=await fixture(),key=randomUUID();
  await api.inviteMember(f.owner,{childIds:[f.a.id],acknowledged:true},key);
  await assert.rejects(api.inviteMember(f.owner,{childIds:[f.b.id],acknowledged:true},key),denied('INVITE_ALREADY_CREATED'));
  const outcomes=await Promise.allSettled([api.join(memberInput(f.invite.code)),api.join({...memberInput(f.invite.code),loginName:'second'})]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  assert.equal((await db.query("SELECT id FROM family_members WHERE family_id=$1 AND role='support'",[f.owner.family_id])).rows.length,1);
});

test('invites validate child scope, reserve bounded capacity and cannot add fields or bypass creator approval',async()=>{
  const f=await fixture(),other=await fixture();
  await assert.rejects(api.inviteMember(f.owner,{childIds:[other.a.id],acknowledged:true},randomUUID()),denied('MEMBER_CHILDREN_UNAVAILABLE'));
  await assert.rejects(api.join({...memberInput(f.invite.code),state:'active',childIds:[f.b.id]}));
  await assert.rejects(api.inviteMember(f.owner,{childIds:[f.a.id,f.a.id],acknowledged:true},randomUUID()));
  for(let i=0;i<2;i++)await api.inviteMember(f.owner,{childIds:[f.a.id],acknowledged:true},randomUUID());
  await assert.rejects(api.inviteMember(f.owner,{childIds:[f.a.id],acknowledged:true},randomUUID()),denied('MEMBER_LIMIT'));
});

test('creator and support lockouts are independent and use one counter across login and account commands',async()=>{
  const f=await fixture(),m=await joined(f);
  for(let i=0;i<7;i++)await assert.rejects(api.logoutAll(m.p,{currentPassword:'wrong password',acknowledged:true}),denied('PASSWORD_REJECTED'));
  await assert.rejects(api.login({...f.credentials,password:'wrong password',memberLogin:'caregiver'}),denied('LOGIN_FAILED'));
  await assert.rejects(api.logoutAll(m.p,{currentPassword:memberInput('').password,acknowledged:true}),denied('ACCOUNT_LOCKED'));
  assert.ok(await api.login(f.credentials));
});

test('upgrading schema 19 preserves original credentials, existing child access, cooldown counters and family records',async()=>{
  const legacy=await openDatabase('memory://');
  try{
    // Run the real historical migrations while deferring only the new versions.
    const deferred:Database={...legacy,transaction:fn=>legacy.transaction(tx=>fn({query:<T>(sql:string,args?:unknown[])=>{
      const version=sql.match(/^SELECT version FROM schema_migrations WHERE version=(20|21|22|23|24|25|26|27|28|29|30|31|32)$/)?.[1];
      return version?Promise.resolve({rows:[{version:Number(version)}] as T[]}):tx.query<T>(sql,args);
    }}))};
    await migrate(deferred);
    assert.equal((await legacy.query<{v:number}>('SELECT max(version) v FROM schema_migrations')).rows[0].v,19);
    const family=randomUUID(),child=randomUUID(),token=randomBytes(32).toString('hex'),childToken=randomBytes(32).toString('hex');
    const salt=randomBytes(16).toString('hex'),password='Existing-pre-members-passphrase!',hash=salt+':'+scryptSync(password,salt,64).toString('hex');
    await legacy.query("INSERT INTO families(id,name,login_name,password_hash,timezone,locale,auth_failures) VALUES($1,'Legacy','legacy',$2,'UTC','en',5)",[family,hash]);
    await legacy.query("INSERT INTO children(id,family_id,alias,age_band,locale) VALUES($1,$2,'Existing Child','9-11','en')",[child,family]);
    await legacy.query("INSERT INTO local_confirmations(id,family_id,child_id,purpose,version,acknowledged_at) VALUES($1,$2,$3,'local-development-only-not-vpc','local-1',$4)",[randomUUID(),family,child,new Date(at).toISOString()]);
    for(const [value,id] of [[token,null],[childToken,child]] as const)await legacy.query('INSERT INTO auth_sessions(token_hash,csrf,family_id,child_id,scope,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[createHash('sha256').update(value).digest('hex'),'synthetic-csrf',family,id,id?'child':'parent',new Date(at+3600000).toISOString()]);
    await migrate(legacy);await migrate(legacy);
    assert.equal((await legacy.query<{n:number}>('SELECT count(*)::int n FROM family_members WHERE family_id=$1',[family])).rows[0].n,1);
    assert.equal((await legacy.query<{auth_failures:number}>('SELECT auth_failures FROM family_members WHERE family_id=$1',[family])).rows[0].auth_failures,5);
    const upgraded=service(legacy,()=>at),p=(await upgraded.authenticate(token))!,cp=(await upgraded.authenticate(childToken))!;
    assert.equal(p.member_role,'owner');assert.equal(cp.member_id,p.member_id);
    assert.equal((await upgraded.me(p)).children[0].id,child);assert.equal((await upgraded.me(cp)).children[0].alias,'Existing Child');
    assert.equal((await upgraded.me(p)).children[0].consentActive,true);
    assert.ok(await upgraded.login({name:'Legacy',password}));
  }finally{await legacy.close();}
});

const list:FamilyMembers={version:'family-members-1',familyId:'synthetic',viewerId:'owner',canManage:true,members:[],invitations:[]};
test('member client clears data on identity mismatch and requires a reload after an uncertain write',async()=>{
  const wrong=new FamilyMembersClient('different','owner',async<T>()=>list as T,()=>{});await wrong.load();assert.equal(wrong.state.data,null);
  let writes=0,fail!:(e:Error)=>void;
  const client=new FamilyMembersClient('synthetic','owner',async<T>(_path:string,method?:string)=>{if(!method)return list as T;writes++;return new Promise<T>((_resolve,reject)=>{fail=reject;});},()=>{});
  await client.load();const writing=client.command('invite',{childIds:['test-child'],key:'synthetic-request'});
  await client.command('invite',{childIds:['other-child'],key:'another-request'});assert.equal(writes,1);
  fail(new Error('Lost response'));await writing;assert.equal(client.state.error,'RESULT_UNCONFIRMED');assert.equal(client.state.code,null);assert.equal(client.state.data,null);
  await client.command('invite',{childIds:['test-child'],key:'third-request'});assert.equal(writes,1);
});

test('member client discards one-time invitation codes on leaving and ignores delayed completion',async()=>{
  let finish!:(value:FamilyMembers)=>void;
  const client=new FamilyMembersClient('synthetic','owner',<T>()=>new Promise<T>(resolve=>{finish=data=>resolve(data as T);}),()=>{});
  const waiting=client.load();client.dispose();finish(list);await waiting;assert.equal(client.state.data,null);assert.equal(client.state.code,null);
  const ready=new FamilyMembersClient('synthetic','owner',async<T>(_path:string,method?:string)=>(method?{id:'new',code:'a'.repeat(64),expiresAt:new Date(at+60000).toISOString()}:list) as T,()=>{});
  await ready.load();await ready.command('invite',{childIds:['test-child'],key:'synthetic'});assert.equal(ready.state.code?.value,'a'.repeat(64));ready.dispose();assert.equal(ready.state.code,null);
});
