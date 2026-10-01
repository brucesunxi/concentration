import { useState } from 'react';
import type { Child } from '../../../packages/contracts/models.ts';
import { collectionStatusAllowsPractice } from '../../../packages/contracts/collection-status.ts';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { useFamilyMembers } from '../../../packages/session-runtime/useFamilyMembers.ts';
import { membersCopy } from '../../../packages/session-runtime/family-members-copy.ts';
import { request } from './api.ts';
import './family-members.css';

export default function FamilyMembers({familyId,viewerId,children,locale,onSignIn}:{familyId:string;viewerId:string;children:Child[];locale:Locale;onSignIn():void}){
  const c=membersCopy(locale),{state,reload,command}=useFamilyMembers(familyId,viewerId,request);
  const [selected,setSelected]=useState<string[]>([]),[ack,setAck]=useState(false);
  const [action,setAction]=useState<{kind:'approve'|'revoke'|'cancel';id:string;version?:number;label:string;childIds:string[]}|null>(null);
  const names=(ids:string[])=>children.filter(x=>ids.includes(x.id)).map(x=>x.alias).join(' · ')||c.noChildren;
  return <section className="family-card members-panel" aria-labelledby="members-title"><h2 id="members-title">{c.title}</h2><p>{c.intro}</p><p className="subtle">{c.scope}</p>
    {state.error&&<p role="alert" className="notice error">{c.error(state.error)}</p>}
    {state.needsLogin&&<button className="primary" onClick={onSignIn}>{c.signin}</button>}
    {state.busy&&<p role="status">{c.loading}</p>}
    {state.code&&<div className="invitation-code" role="status"><h3>{c.code}</h3><textarea aria-label={c.joinCode} readOnly rows={3} value={state.code.value} /><p>{c.codeHelp}</p><p>{new Date(state.code.expiresAt).toLocaleString(locale)}</p></div>}
    {state.data&&<>
      <ul className="member-list">{state.data.members.map(m=><li key={m.id}><div><h3>{m.displayName}</h3><p>{m.loginName} · {m.role==='owner'?c.owner:c.support} · {m.state==='pending'?c.pendingLabel:m.state==='active'?c.active:c.revoked}</p><p className="subtle">{m.role==='owner'?c.allChildren:names(m.childIds)}</p></div>{state.data?.canManage&&m.role!=='owner'&&m.state!=='revoked'&&<div className="member-actions">{m.state==='pending'&&<button className="quiet" disabled={state.busy} onClick={()=>{setAck(false);setAction({kind:'approve',id:m.id,version:m.version,label:m.displayName+' · '+m.loginName,childIds:m.childIds});}}>{c.approve}</button>}<button className="quiet" disabled={state.busy} onClick={()=>{setAck(false);setAction({kind:'revoke',id:m.id,version:m.version,label:m.displayName+' · '+m.loginName,childIds:m.childIds});}}>{c.revoke}</button></div>}</li>)}</ul>
      {state.data.canManage&&!action&&<form className="stack-form" onSubmit={e=>{e.preventDefault();if(!ack||!selected.length)return;setAck(false);void command('invite',{childIds:selected,key:crypto.randomUUID()});}}><h3>{c.invite}</h3><fieldset disabled={state.busy}><legend>{c.select}</legend>{children.filter(x=>collectionStatusAllowsPractice(x.collectionStatus,x.consentActive)).map(child=><label className="check-label" key={child.id}><input type="checkbox" checked={selected.includes(child.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,child.id]:ids.filter(x=>x!==child.id))}/>{child.alias}</label>)}</fieldset><label className="check-label"><input type="checkbox" checked={ack} disabled={state.busy} onChange={e=>setAck(e.target.checked)}/>{c.ackInvite}</label><button className="primary" disabled={state.busy||!ack||!selected.length}>{c.invite}</button></form>}
      {state.data.canManage&&action&&<form className="stack-form member-confirm" onSubmit={e=>{e.preventDefault();if(!ack)return;const next=action;setAction(null);setAck(false);void command(next.kind,next);}}><h3>{action.label}</h3><p>{names(action.childIds)}</p><label className="check-label"><input type="checkbox" checked={ack} disabled={state.busy} onChange={e=>setAck(e.target.checked)}/>{action.kind==='approve'?c.ackApprove:action.kind==='revoke'?c.ackRevoke:c.ackCancel}</label><div className="member-actions"><button className="primary" disabled={state.busy||!ack}>{c.confirm}</button><button type="button" className="quiet" disabled={state.busy} onClick={()=>{setAction(null);setAck(false);}}>{c.cancel}</button></div></form>}
      {state.data.canManage&&state.data.invitations.length>0&&<><h3>{c.invitations}</h3><ul className="member-list">{state.data.invitations.map(i=><li key={i.id}><div><p>{names(i.childIds)}</p><p className="subtle">{c[i.state]} · {new Date(i.expiresAt).toLocaleString(locale)}</p></div>{i.state==='open'&&<button className="quiet" disabled={state.busy} onClick={()=>{setAck(false);setAction({kind:'cancel',id:i.id,label:c.cancelInvite,childIds:i.childIds});}}>{c.cancelInvite}</button>}</li>)}</ul></>}
    </>}
    <button className="quiet" disabled={state.busy} onClick={()=>{setAction(null);setAck(false);void reload();}}>{c.reload}</button>
  </section>;
}
