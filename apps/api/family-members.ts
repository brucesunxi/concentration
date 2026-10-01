import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Database, Queryable } from './database.ts';
import type { DatabaseContext } from './database-context.ts';
import type { AuthTransport, Principal } from './service.ts';
import { inviteInput, joinInput, memberActionInput, cancelInviteInput } from '../../packages/contracts/family-members.ts';
import type { FamilyMembers, MemberIdentity, MemberRole, MemberState } from '../../packages/contracts/family-members.ts';
import { activeLocalConfirmationSql, activeVerifiedConsentSql } from './collection-authority.ts';
import type { ReleaseScope } from './release-scope.ts';

export interface MemberRow {
  id: string; family_id: string; login_name: string; display_name: string; role: MemberRole; state: MemberState;
  child_ids: string[]; version: number; password_hash: string; auth_failures: number; auth_locked_until: string | null; password_changed_at: string | null; created_at: string;
}
interface InviteRow { id: string; family_id: string; created_by: string; child_ids: string[]; expires_at: string; cancelled_at: string | null; accepted_by: string | null }
export const identity = (m: MemberRow): MemberIdentity => ({ id:m.id,loginName:m.login_name,displayName:m.display_name,role:m.role,state:m.state });
export const memberContext = (p: Principal): DatabaseContext => ({mode:'family',familyId:p.family_id,childId:p.child_id,scope:p.scope,memberId:p.member_id,memberRole:p.member_role,memberState:p.member_state,childIds:p.allowed_children});
const digest = (s:string) => createHash('sha256').update(s).digest('hex');
const one = async <T>(db:Queryable,sql:string,args:unknown[]=[]) => (await db.query<T>(sql,args)).rows[0];
export function familyMembers(db:Database, hooks:{
  now:()=>number; fail:(status:number,code:string,message:string)=>never;
  owner:(p:Principal)=>void; hashPassword:(value:string)=>Promise<string>;
  context:<T>(context:DatabaseContext,action:()=>Promise<T>)=>Promise<T>;
  token:(familyId:string,childId:null,transport:AuthTransport,tx:Queryable,deviceId:null,memberId:string)=>Promise<{value:string;csrf:string}>;
  releaseScope: ReleaseScope;
}) {
  const {now,fail}=hooks;
  async function audit(tx:Queryable,family:string,actor:string,action:string,target:string|null=null,invite:string|null=null) {
    await tx.query('INSERT INTO family_member_audit(id,family_id,actor_id,target_id,invitation_id,action,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),family,actor,target,invite,action,new Date(now()).toISOString()]);
  }
  async function checkChildren(tx:Queryable,family:string,ids:string[]) {
    const approved=hooks.releaseScope.mode==='approved';
    const evidence=approved ? activeVerifiedConsentSql('c',3,4) : activeLocalConfirmationSql('c',3);
    const rows=await tx.query(`SELECT c.id FROM children c WHERE c.family_id=$1 AND c.id=ANY($2::uuid[]) AND c.consent_active=true AND ${evidence}`,
      approved ? [family,ids,new Date(now()).toISOString(),hooks.releaseScope.identity] : [family,ids,new Date(now()).toISOString()]);
    if(rows.rows.length!==ids.length)fail(409,'MEMBER_CHILDREN_UNAVAILABLE','请重新选择仍允许练习的孩子。');
  }
  return {
    async read(p:Principal):Promise<FamilyMembers> {
      const rows=await db.query<MemberRow>("SELECT * FROM family_members WHERE family_id=$1 AND ($2::boolean OR id=$3) ORDER BY (role='owner') DESC,created_at,id",[p.family_id,p.member_role==='owner',p.member_id]);
      const invites=p.member_role==='owner' ? (await db.query<InviteRow>('SELECT * FROM family_invitations WHERE family_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[p.family_id])).rows : [];
      return {version:'family-members-1',familyId:p.family_id,viewerId:p.member_id,canManage:p.member_role==='owner',
        members:rows.rows.map(m=>({...identity(m),childIds:p.member_state==='pending'?[]:m.child_ids,version:m.version,createdAt:new Date(m.created_at).toISOString()})),
        invitations:invites.map(i=>({id:i.id,childIds:i.child_ids,expiresAt:new Date(i.expires_at).toISOString(),state:i.cancelled_at?'cancelled':i.accepted_by?'accepted':Date.parse(i.expires_at)<=now()?'expired':'open'}))};
    },
    async invite(p:Principal,raw:unknown,key:string) {
      hooks.owner(p);const input=inviteInput.parse(raw);
      if(!key||key.length<16||key.length>128)fail(400,'INVALID_IDEMPOTENCY_KEY','需要有效的请求标识。');
      if(await one(db,'SELECT id FROM family_invitations WHERE family_id=$1 AND request_key=$2',[p.family_id,key]))fail(409,'INVITE_ALREADY_CREATED','这份邀请已创建，请查看邀请列表。邀请码只显示一次。');
      await checkChildren(db,p.family_id,input.childIds);
      const count=await one<{n:number}>(db,"SELECT count(*)::int n FROM family_members WHERE family_id=$1 AND state<>'revoked'",[p.family_id]);
      const open=await one<{n:number}>(db,'SELECT count(*)::int n FROM family_invitations WHERE family_id=$1 AND accepted_by IS NULL AND cancelled_at IS NULL AND expires_at>$2',[p.family_id,new Date(now()).toISOString()]);
      if(count.n+open.n>=4)fail(409,'MEMBER_LIMIT','一个家庭最多有四位家长，待接受的邀请也占一个名额。');
      const id=randomUUID(),code=randomBytes(32).toString('hex'),expiresAt=new Date(now()+48*3600000).toISOString();
      await db.query('INSERT INTO family_invitations(id,family_id,created_by,child_ids,code_hash,request_key,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,p.family_id,p.member_id,input.childIds,digest(code),key,new Date(now()).toISOString(),expiresAt]);
      await audit(db,p.family_id,p.member_id,'invite',null,id);
      return {id,code,expiresAt};
    },
    async cancel(p:Principal,id:string,raw:unknown) {
      hooks.owner(p);cancelInviteInput.parse(raw);
      const i=await one<InviteRow>(db,'SELECT * FROM family_invitations WHERE id=$1 AND family_id=$2 FOR UPDATE',[id,p.family_id]);
      if(!i)fail(404,'NOT_FOUND','未找到邀请。');
      if(i.accepted_by)fail(409,'INVITE_ACCEPTED','邀请已接受，请在家长列表中处理该成员。');
      if(!i.cancelled_at){await db.query('UPDATE family_invitations SET cancelled_at=$2 WHERE id=$1',[id,new Date(now()).toISOString()]);await audit(db,p.family_id,p.member_id,'cancel',null,id);}
      return {ok:true};
    },
    async act(p:Principal,id:string,raw:unknown,match:unknown) {
      hooks.owner(p);const input=memberActionInput.parse(raw);
      if(typeof match!=='string'||!/^"[1-9][0-9]{0,8}"$/.test(match))fail(428,'VERSION_REQUIRED','请先读取当前家长列表。');
      const m=await one<MemberRow>(db,'SELECT * FROM family_members WHERE family_id=$1 AND id=$2 FOR UPDATE',[p.family_id,id]);
      if(!m)fail(404,'NOT_FOUND','未找到这位家长。');
      if(m.role==='owner')fail(403,'OWNER_PROTECTED','家庭创建者不能通过此操作移除或替换。');
      if(m.version!==Number(String(match).slice(1,-1)))fail(409,'MEMBER_VERSION_CONFLICT','家长权限已更新，请重新读取后确认。');
      if(input.action==='approve'){
        if(m.state!=='pending')fail(409,'MEMBER_STATE_CONFLICT','只有等待确认的家长可以批准。');
        await checkChildren(db,p.family_id,m.child_ids);
        await db.query("UPDATE family_members SET state='active',approved_at=$2,version=version+1 WHERE id=$1",[id,new Date(now()).toISOString()]);
      }else{
        if(m.state==='revoked')fail(409,'MEMBER_STATE_CONFLICT','这位家长的访问已撤销。');
        await db.query("UPDATE family_members SET state='revoked',revoked_at=$2,version=version+1 WHERE id=$1",[id,new Date(now()).toISOString()]);
        await db.query('DELETE FROM auth_sessions WHERE family_id=$1 AND member_id=$2',[p.family_id,id]);
      }
      await audit(db,p.family_id,p.member_id,input.action,id);
      return {ok:true};
    },
    async join(raw:unknown,transport:AuthTransport='web') {
      const input=joinInput.parse(raw),hash=await hooks.hashPassword(input.password);
      try{return await hooks.context({mode:'join',inviteHash:digest(input.code)},()=>db.transaction(async tx=>{
        let invite=await one<InviteRow>(tx,'SELECT * FROM family_invitations WHERE code_hash=$1',[digest(input.code)]);
        if(!invite)fail(409,'INVITE_UNAVAILABLE','邀请不可用，可能已过期、取消或接受。');
        await tx.query('SELECT id FROM families WHERE id=$1 FOR UPDATE',[invite.family_id]);
        invite=await one<InviteRow>(tx,'SELECT * FROM family_invitations WHERE code_hash=$1 FOR UPDATE',[digest(input.code)]);
        if(!invite||invite.cancelled_at||invite.accepted_by||Date.parse(invite.expires_at)<=now())fail(409,'INVITE_UNAVAILABLE','邀请不可用，可能已过期、取消或接受。');
        // Scope was chosen by the creator. It is never taken from the join body.
        const id=randomUUID();
        await tx.query("INSERT INTO family_members(id,family_id,login_name,display_name,role,state,child_ids,password_hash,created_at) VALUES($1,$2,$3,$4,'support','pending',$5,$6,$7)",[id,invite.family_id,input.loginName,input.displayName,invite.child_ids,hash,new Date(now()).toISOString()]);
        await tx.query('UPDATE family_invitations SET accepted_by=$2,accepted_at=$3 WHERE id=$1',[invite.id,id,new Date(now()).toISOString()]);
        await audit(tx,invite.family_id,id,'join',id,invite.id);
        return hooks.token(invite.family_id,null,transport,tx,null,id);
      }));}catch(error){if((error as {code?:string}).code==='23505')fail(409,'MEMBER_NAME_TAKEN','此家庭已使用这个家长登录名，请换一个。');throw error;}
    },
  };
}
