import {useRef,useEffect,useState} from 'react';
import {Text} from 'react-native';
import type {Locale} from '../../../packages/task-engine/index.ts';
import type {Me} from '../../../packages/contracts/models.ts';
import {joinInput} from '../../../packages/contracts/family-members.ts';
import {membersCopy} from '../../../packages/session-runtime/family-members-copy.ts';
import type {MobileClient} from './client';
import {Page,Button,Field,CheckBox,Notice,s} from './ui';
export function JoinFamily({locale,client,onJoined,onBack}:{locale:Locale;client:MobileClient;onJoined(me:Me):void;onBack():void}){
  const c=membersCopy(locale),live=useRef(true),[code,setCode]=useState(''),[name,setName]=useState(''),[display,setDisplay]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  return <Page title={c.join} subtitle={c.joinIntro}><Notice>{error}</Notice><Field label={c.joinCode} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} maxLength={64} editable={!busy}/><Field label={c.member} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} maxLength={32} editable={!busy}/><Field label={c.display} value={display} onChangeText={setDisplay} maxLength={24} editable={!busy}/><Text style={s.muted}>{c.passwordHint}</Text><Field label={c.password} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy}/><Field label={c.repeat} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!busy}/><CheckBox label={c.localAck} value={ack} onChange={setAck} disabled={busy}/><Button title={busy?c.busy:c.join} disabled={busy||!ack} onPress={()=>{
    const parsed=joinInput.safeParse({code:code.trim(),loginName:name,displayName:display,password,acknowledgedLocalUse:ack});
    if(!parsed.success||password!==repeat){setError(c.error('INVALID_REQUEST'));return;}
    setBusy(true);setError('');setPassword('');setRepeat('');void client.join(parsed.data).then(me=>{if(live.current)onJoined(me);}).catch(e=>{if(live.current)setError(c.error(e.code??'RESULT_UNCONFIRMED'));}).finally(()=>{if(live.current)setBusy(false);});
  }}/><Button quiet title={c.cancel} disabled={busy} onPress={onBack}/></Page>;
}
