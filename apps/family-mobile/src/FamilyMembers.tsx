import {useCallback,useState} from 'react';
import {Text,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import type {Child} from '../../../packages/contracts/models.ts';
import {collectionStatusAllowsPractice} from '../../../packages/contracts/collection-status.ts';
import type {Locale} from '../../../packages/task-engine/index.ts';
import {useFamilyMembers} from '../../../packages/session-runtime/useFamilyMembers.ts';
import {membersCopy} from '../../../packages/session-runtime/family-members-copy.ts';
import type {MobileClient} from './client';
import {Page,Button,CheckBox,Notice,s} from './ui';
export function FamilyMembers({familyId,viewerId,children,locale,client,onBack,onLogin}:{familyId:string;viewerId:string;children:Child[];locale:Locale;client:MobileClient;onBack():void;onLogin():void}){
  const request=useCallback(<T,>(path:string,method?:string,data?:unknown,headers?:Record<string,string>)=>client.request<T>(path,method,data,headers),[client]);
  const {state,reload,command}=useFamilyMembers(familyId,viewerId,request),c=membersCopy(locale);
  const [selected,setSelected]=useState<string[]>([]),[ack,setAck]=useState(false),[action,setAction]=useState<{kind:'approve'|'revoke'|'cancel';id:string;version?:number;label:string;childIds:string[]}|null>(null);
  const names=(ids:string[])=>children.filter(x=>ids.includes(x.id)).map(x=>x.alias).join(' · ')||c.noChildren;
  return <Page title={c.title} subtitle={c.intro}><Text style={s.body}>{c.scope}</Text><Notice>{state.error&&c.error(state.error)}</Notice>
    {state.needsLogin&&<Button title={c.signin} onPress={onLogin}/>}{state.busy&&<Text accessibilityLiveRegion="polite">{c.loading}</Text>}
    {state.code&&<View style={s.card}><Text accessibilityRole="header" style={s.heading}>{c.code}</Text><Text selectable style={s.body}>{state.code.value}</Text><Text style={s.body}>{c.codeHelp}</Text><Text style={s.muted}>{new Date(state.code.expiresAt).toLocaleString(locale)}</Text></View>}
    {state.data&&<>
      {state.data.members.map(m=><View key={m.id} style={s.card}><Text style={s.heading}>{m.displayName}</Text><Text style={s.body}>{m.loginName} · {m.role==='owner'?c.owner:c.support} · {m.state==='active'?c.active:m.state==='pending'?c.pendingLabel:c.revoked}</Text><Text style={s.muted}>{m.role==='owner'?c.allChildren:names(m.childIds)}</Text>{state.data?.canManage&&m.role!=='owner'&&m.state!=='revoked'&&<>{m.state==='pending'&&<Button quiet title={c.approve} disabled={state.busy} onPress={()=>{setAck(false);setAction({kind:'approve',id:m.id,version:m.version,label:m.displayName+' · '+m.loginName,childIds:m.childIds});}}/>}<Button quiet title={c.revoke} disabled={state.busy} onPress={()=>{setAck(false);setAction({kind:'revoke',id:m.id,version:m.version,label:m.displayName+' · '+m.loginName,childIds:m.childIds});}}/></>}</View>)}
      {state.data.canManage&&!action&&<View style={s.card}><Text style={s.heading}>{c.invite}</Text><Text style={s.body}>{c.select}</Text>{children.filter(x=>collectionStatusAllowsPractice(x.collectionStatus,x.consentActive)).map(child=><CheckBox key={child.id} label={child.alias} value={selected.includes(child.id)} disabled={state.busy} onChange={checked=>setSelected(ids=>checked?[...ids,child.id]:ids.filter(x=>x!==child.id))}/>)}<CheckBox label={c.ackInvite} value={ack} onChange={setAck} disabled={state.busy}/><Button title={c.invite} disabled={state.busy||!ack||!selected.length} onPress={()=>{setAck(false);void command('invite',{childIds:selected,key:randomUUID()});}}/></View>}
      {state.data.canManage&&action&&<View style={s.card}><Text style={s.heading}>{action.label}</Text><Text style={s.body}>{names(action.childIds)}</Text><CheckBox label={action.kind==='approve'?c.ackApprove:action.kind==='revoke'?c.ackRevoke:c.ackCancel} value={ack} onChange={setAck} disabled={state.busy}/><Button title={c.confirm} disabled={state.busy||!ack} onPress={()=>{const next=action;setAction(null);setAck(false);void command(next.kind,next);}}/><Button quiet title={c.cancel} onPress={()=>{setAction(null);setAck(false);}} disabled={state.busy}/></View>}
      {state.data.canManage&&state.data.invitations.length>0&&<><Text accessibilityRole="header" style={s.heading}>{c.invitations}</Text>{state.data.invitations.map(i=><View key={i.id} style={s.card}><Text style={s.body}>{names(i.childIds)}</Text><Text style={s.muted}>{c[i.state]} · {new Date(i.expiresAt).toLocaleString(locale)}</Text>{i.state==='open'&&<Button quiet title={c.cancelInvite} disabled={state.busy} onPress={()=>{setAck(false);setAction({kind:'cancel',id:i.id,label:c.cancelInvite,childIds:i.childIds});}}/>}</View>)}</>}
    </>}
    <Button quiet title={c.reload} disabled={state.busy} onPress={()=>{setAction(null);setAck(false);void reload();}}/><Button quiet title={c.cancel} disabled={state.busy} onPress={onBack}/>
  </Page>;
}
