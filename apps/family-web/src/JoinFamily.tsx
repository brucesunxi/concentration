import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../../../packages/task-engine/index.ts';
import {joinInput} from '../../../packages/contracts/family-members.ts';
import {membersCopy} from '../../../packages/session-runtime/family-members-copy.ts';
import {request} from './api.ts';
import './family-members.css';
export default function JoinFamily({locale,onJoined,onBusyChange}:{locale:Locale;onJoined():Promise<void>;onBusyChange(value:boolean):void}){
  const c=membersCopy(locale),[busy,setBusy]=useState(false),[error,setError]=useState(''),live=useRef(true),writing=useRef(false);
  useEffect(()=>{live.current=true;return()=>{live.current=false;onBusyChange(false);};},[onBusyChange]);
  return <form className="stack-form join-family-form" onSubmit={event=>{event.preventDefault();if(writing.current)return;const form=event.currentTarget,data=new FormData(form);
    const parsed=joinInput.safeParse({code:String(data.get('code')).trim(),loginName:data.get('login'),displayName:data.get('display'),password:data.get('password'),acknowledgedLocalUse:data.get('ack')==='on'});
    if(!parsed.success||data.get('password')!==data.get('repeat')){setError(c.error('INVALID_REQUEST'));return;}
    writing.current=true;setBusy(true);onBusyChange(true);setError('');form.reset();void request('/auth/join','POST',parsed.data).then(()=>{if(live.current)return onJoined();}).catch(e=>{if(live.current)setError(c.error(e.code??'RESULT_UNCONFIRMED'));}).finally(()=>{writing.current=false;if(live.current){setBusy(false);onBusyChange(false);}});
  }}><h3>{c.join}</h3><p>{c.joinIntro}</p><label>{c.joinCode}<textarea name="code" rows={3} required maxLength={64} autoComplete="off" spellCheck={false} disabled={busy}/></label><label>{c.member}<input name="login" autoComplete="username" required minLength={3} maxLength={32} disabled={busy}/></label><label>{c.display}<input name="display" required maxLength={24} disabled={busy}/></label><p className="subtle">{c.passwordHint}</p><label>{c.password}<input name="password" type="password" autoComplete="new-password" required minLength={15} maxLength={128} disabled={busy}/></label><label>{c.repeat}<input name="repeat" type="password" autoComplete="new-password" required minLength={15} maxLength={128} disabled={busy}/></label><label className="check-label"><input name="ack" type="checkbox" required disabled={busy}/>{c.localAck}</label>{error&&<p className="notice error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?c.busy:c.join}</button></form>;
}
