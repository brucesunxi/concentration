import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { Child } from '../../../packages/contracts/models.ts';
import type { AgeBand, Locale } from '../../../packages/task-engine/index.ts';
import { MobileClient, MobileRequestError } from './client';
import { Button, CheckBox, Choice, Notice, s } from './ui';

type Space={childId:string;currentAgeBand:AgeBand;version:number;state:'current'|'due'|'pending'|'adult-pending';dueAt:string;targetAgeBand:AgeBand|'18+'|null;unfinished:{id:string;createdAt:string;uploadUntil:string|null}[]};
const bands=['6-8','9-11','12-14','15-17','18+'] as const;
export function AgeReview({child,locale,mode,client,onChanged,onRequireLogin}:{child:Child;locale:Locale;mode:string;client:MobileClient;onChanged():void;onRequireLogin():void}){
  const en=locale==='en',t=(zh:string,english:string)=>en?english:zh;
  const [space,setSpace]=useState<Space|null>(null),[target,setTarget]=useState<AgeBand|'18+'>(child.ageBand),[ack,setAck]=useState(false),[localAck,setLocalAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const attempt=useRef<{target:string;key:string}|null>(null);
  async function load(){const data=await client.request<Space>(`/children/${child.id}/age-review`);setSpace(data);setTarget(data.targetAgeBand??data.currentAgeBand);}
  useEffect(()=>{let active=true;void client.request<Space>(`/children/${child.id}/age-review`).then(data=>{if(active){setSpace(data);setTarget(data.targetAgeBand??data.currentAgeBand);}}).catch(()=>{if(active)setError(t('暂时无法读取复核状态。','Could not load the review status.'));});return()=>{active=false;};},[child.id]);
  async function act(kind:'request'|'apply'){
    if(!space||!ack||busy||(kind==='apply'&&mode==='local-development'&&!localAck))return;
    setBusy(true);setError('');setSaved('');
    try{
      if(kind==='request'){
        if(attempt.current?.target!==target)attempt.current={target,key:randomUUID()};
        await client.request(`/children/${child.id}/age-review`,'POST',{targetAgeBand:target,acknowledged:true},{'If-Match':`"${space.version}"`,'Idempotency-Key':attempt.current.key});
        attempt.current=null;
      }else await client.request(`/children/${child.id}/age-review/apply`,'POST',{acknowledged:true,...(mode==='local-development'?{localConfirmation:localAck}:{})},{'If-Match':`"${space.version}"`});
      setAck(false);setLocalAck(false);await load();onChanged();setSaved(t('复核状态已更新。','Review status updated.'));
    }catch(e){
      const code=e instanceof MobileRequestError?e.code:'';
      if(code==='REAUTH_REQUIRED'||code==='UNAUTHENTICATED'){onRequireLogin();return;}
      if(code==='AGE_REVIEW_VERSION_CONFLICT')await load().catch(()=>{});
      setError(code==='UNFINISHED_SESSIONS'?t('请先处理旧设备上未结束的练习。','Resolve unfinished practice on the older device.'):code==='AGE_REVIEW_VERSION_CONFLICT'?t('档案已在另一处更新，请核对最新状态。','The profile changed elsewhere. Review its current status.'):t('未能完成，请检查连接后重试。','Could not finish. Check your connection and retry.'));
    }finally{setBusy(false);}
  }
  return <View style={s.card}><Text accessibilityRole="header" style={s.heading}>{t('年龄档复核','Age band review')}</Text>
    {!space?<Text style={s.body}>{t('正在读取…','Loading…')}</Text>:<>
      <Text style={s.body}>{t(`当前 ${space.currentAgeBand} 岁；下次复核 ${new Date(space.dueAt).toLocaleDateString(locale)}。`,`Current band ${space.currentAgeBand}; next review ${new Date(space.dueAt).toLocaleDateString(locale)}.`)}</Text>
      {space.state!=='current'&&<Notice>{space.state==='adult-pending'?t('成年转换需要独立身份与资料权利流程。新练习已暂停。','Adult transition needs a separate identity and data-rights review. New practice is paused.'):space.state==='pending'?t(`准备变更为 ${space.targetAgeBand} 岁。新练习已暂停；旧记录保留。`,`Changing to ${space.targetAgeBand}. New practice is paused; earlier records are preserved.`):t('年龄档需要家长确认后才能开始新练习。','A parent needs to confirm the age band before new practice.')}</Notice>}
      {space.unfinished.length>0&&<Notice>{t(`还有 ${space.unfinished.length} 次旧练习未结束。请先从恢复入口处理；原设备可在授权期限内补传。`,`There are ${space.unfinished.length} unfinished earlier practices. Resolve them in Recovery; the original device can upload within its grant.`)}</Notice>}
      <Text style={s.muted}>{t('确认适合的年龄档','Confirm the age band')}</Text><View style={s.row}>{bands.map(b=><Choice key={b} label={b} selected={target===b} disabled={busy} onPress={()=>{setTarget(b);setAck(false);setLocalAck(false);}}/>)}</View>
      <CheckBox value={ack} disabled={busy} onChange={setAck} label={t('我已核对年龄档；变更前会处理旧设备的练习与本机记录。','I checked the age band and will resolve older device practice and local records before applying a change.')}/>
      {space.state==='pending'&&target===space.targetAgeBand&&mode==='local-development'&&<CheckBox value={localAck} disabled={busy} onChange={setLocalAck} label={t('我同意在这台设备继续保存新年龄档的本地测试记录，并会让孩子每次自行选择是否参加。','I agree to save local test records for the new age band on this device and let my child choose each time whether to take part.')}/>}
      <Button title={space.state==='adult-pending'&&target==='18+'?t('等待独立权利核验','Await rights review'):space.state==='pending'&&target===space.targetAgeBand?t('让新年龄档生效','Apply the new age band'):target===space.currentAgeBand?t('确认当前年龄档','Confirm current band'):t('提出年龄档变更','Request age band change')} disabled={!ack||busy||(space.state==='adult-pending'&&target==='18+')||(space.state==='pending'&&target===space.targetAgeBand&&mode==='local-development'&&!localAck)} onPress={()=>void act(space.state==='pending'&&target===space.targetAgeBand?'apply':'request')}/>
      {space.state==='pending'&&<Text style={s.muted}>{t('生效后年龄相关进度和每日额度会重置，监护许可重新核对；历史记录保留原年龄。','Applying resets age-specific progress and daily limits and rechecks guardian permission. Earlier records keep their original age band.')}</Text>}
    </>}
    <Notice>{error}</Notice><Notice>{saved}</Notice>
  </View>;
}
