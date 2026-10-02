import { useEffect, useRef, useState } from 'react';
import type { Child } from '../../../packages/contracts/models.ts';
import type { AgeBand, Locale } from '../../../packages/task-engine/index.ts';
import { request, RequestError } from './api.ts';
import { isHostedPreview } from './preview-context.ts';

type Space = { childId:string; currentAgeBand:AgeBand; locale:Locale; version:number; state:'current'|'due'|'pending'|'adult-pending'; dueAt:string; targetAgeBand:AgeBand|'18+'|null; canEdit:boolean; unfinished:{id:string;createdAt:string;uploadUntil:string|null;uploadExpired:boolean}[] };
const bands=['6-8','9-11','12-14','15-17','18+'] as const;
export default function AgeReview({child,locale,owner,mode,onRefresh,onParent}:{child:Child;locale:Locale;owner:boolean;mode:string;onRefresh():Promise<unknown>;onParent():void}){
  const en=locale==='en', t=(zh:string,english:string)=>en?english:zh;
  const [space,setSpace]=useState<Space|null>(null),[target,setTarget]=useState<AgeBand|'18+'>(child.ageBand),[ack,setAck]=useState(false),[localAck,setLocalAck]=useState(false),[expiredAck,setExpiredAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const attempt=useRef<{target:string;key:string}|null>(null);
  const canResolveExpired=!!space&&space.state==='pending'&&space.unfinished.length>0&&space.unfinished.every(item=>item.uploadExpired);
  async function load(){const data=await request<Space>(`/children/${child.id}/age-review`);setSpace(data);setTarget(data.targetAgeBand??data.currentAgeBand);setExpiredAck(false);}
  useEffect(()=>{let active=true;void request<Space>(`/children/${child.id}/age-review`).then(data=>{if(active){setSpace(data);setTarget(data.targetAgeBand??data.currentAgeBand);}}).catch(()=>{if(active)setError(t('暂时无法读取复核状态。','Could not load the review status.'));});return()=>{active=false;};},[child.id]);
  async function act(kind:'request'|'apply'){
    if(!space||!ack||busy||(kind==='apply'&&mode==='local-development'&&!localAck)||(kind==='apply'&&canResolveExpired&&!expiredAck))return;
    setBusy(true);setError('');setSaved('');
    try{
      if(kind==='request'){
        if(attempt.current?.target!==target)attempt.current={target,key:crypto.randomUUID()};
        await request(`/children/${child.id}/age-review`,'POST',{targetAgeBand:target,acknowledged:true},{'If-Match':`"${space.version}"`,'Idempotency-Key':attempt.current.key});
        attempt.current=null;
      }else await request(`/children/${child.id}/age-review/apply`,'POST',{acknowledged:true,...(mode==='local-development'?{localConfirmation:localAck}:{}),...(canResolveExpired&&expiredAck?{resolveExpiredUploads:true}:{})},{'If-Match':`"${space.version}"`});
      setAck(false);setLocalAck(false);await load();await onRefresh();setSaved(kind==='request'?t('复核状态已更新。','Review status updated.'):t('新年龄档已生效，请核对新的练习许可。','The new age band is active. Check practice permission.'));
    }catch(e){
      const code=e instanceof RequestError?e.code:'';
      if(code==='REAUTH_REQUIRED'||code==='UNAUTHENTICATED'){onParent();return;}
      if(code==='UNFINISHED_SESSIONS')setError(t('请先结束或处理下列未结束的旧练习，再回来确认。','Resolve the unfinished practice below before applying the change.'));
      else if(code==='AGE_REVIEW_VERSION_CONFLICT'){await load().catch(()=>{});setError(t('另一处已更新档案，请核对最新状态。','This profile changed elsewhere. Review its current status.'));}
      else setError(t('未能完成，请检查网络后重试。','Could not finish. Check your connection and retry.'));
    }finally{setBusy(false);}
  }
  return <section className="family-card" aria-labelledby={`age-${child.id}`}><h3 id={`age-${child.id}`}>{child.alias} · {t('年龄档复核','Age band review')}</h3>
    {!space?<p role="status">{t('正在读取…','Loading…')}</p>:<>
      <p>{t(`当前 ${space.currentAgeBand} 岁；下次复核 ${new Date(space.dueAt).toLocaleDateString(locale)}。`,`Current band ${space.currentAgeBand}; next review ${new Date(space.dueAt).toLocaleDateString(locale)}.`)}</p>
      {space.state!=='current'&&<p className="notice" role="status">{space.state==='adult-pending'?t('成年转换需要独立身份与资料权利流程。新练习已暂停。','Adult transition needs a separate identity and data-rights review. New practice is paused.'):space.state==='pending'?t(`准备变更为 ${space.targetAgeBand} 岁。新练习已暂停，旧记录保留。`,`Changing to ${space.targetAgeBand}. New practice is paused; earlier records are preserved.`):t('年龄档需要家长确认后才能开始新练习。','A parent needs to confirm the age band before new practice.')}</p>}
      {space.unfinished.length>0&&<div className="notice"><strong>{t('未结束的旧练习','Unfinished earlier practice')}: {space.unfinished.length}</strong><ul>{space.unfinished.map(s=><li key={s.id}>{new Date(s.createdAt).toLocaleString(locale)} · {s.uploadUntil?s.uploadExpired?t(`补传期限已过：${new Date(s.uploadUntil).toLocaleString(locale)}`,`Upload deadline passed: ${new Date(s.uploadUntil).toLocaleString(locale)}`):t(`可补传至 ${new Date(s.uploadUntil).toLocaleString(locale)}`,`Upload until ${new Date(s.uploadUntil).toLocaleString(locale)}`):t('请在原设备处理','Resolve on the original device')}</li>)}</ul></div>}
      {owner&&<div className="stack-form"><label>{t('确认适合的年龄档','Confirm the age band')}<select value={target} disabled={busy} onChange={e=>{setTarget(e.target.value as AgeBand|'18+');setAck(false);setLocalAck(false);setExpiredAck(false);}}>{bands.map(b=><option key={b} value={b}>{b}{b==='18+'?'':t(' 岁',' years')}</option>)}</select></label>
        <label className="check-label"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>{t('我已核对年龄档；如果变更，我会先处理旧设备的练习与本机记录。','I checked the age band. Before applying a change I will resolve older device practice and local records.')}</label>
        {space.state==='pending'&&target===space.targetAgeBand&&mode==='local-development'&&<label className="check-label"><input type="checkbox" checked={localAck} disabled={busy} onChange={e=>setLocalAck(e.target.checked)}/>{isHostedPreview() ? t('我会只用虚构资料继续测试新年龄档，知道新记录保存在云端，并会让孩子每次自行选择是否参加。','I will use fictional details to test the new age band, understand that new records are saved in the cloud, and let the child choose each time whether to join.') : t('我同意在这台设备继续保存新年龄档的本地测试记录，并会让孩子每次自行选择是否参加。','I agree to save local test records for the new age band on this device and let my child choose each time whether to take part.')}</label>}
        {canResolveExpired&&target===space.targetAgeBand&&<label className="check-label"><input type="checkbox" checked={expiredAck} disabled={busy} onChange={e=>setExpiredAck(e.target.checked)}/>{t('我已确认这些旧练习的补传期限已过。服务器会保留已收到的步骤，但原设备上未上传的步骤不能再合并；我会自行保留或导出原设备记录。','I understand these upload deadlines have passed. The server keeps received steps, but cannot merge steps left only on the old device. I will keep or export that device’s records separately.')}</label>}
        <button className="primary" disabled={!ack||busy||(space.state==='adult-pending'&&target==='18+')||(space.state==='pending'&&target===space.targetAgeBand&&mode==='local-development'&&!localAck)||(canResolveExpired&&target===space.targetAgeBand&&!expiredAck)} onClick={()=>void act(space.state==='pending'&&target===space.targetAgeBand?'apply':'request')}>{space.state==='adult-pending'&&target==='18+'?t('等待独立权利核验','Await rights review'):space.state==='pending'&&target===space.targetAgeBand?t('让新年龄档生效','Apply the new age band'):target===space.currentAgeBand?t('确认当前年龄档','Confirm current band'):t('提出年龄档变更','Request age band change')}</button>
        {space.state==='pending'&&target===space.targetAgeBand&&<p className="subtle">{t('生效后会重置年龄相关练习进度与每日额度，并重新检查监护许可；历史记录仍保留原年龄。','Applying resets age-specific practice progress and daily limits and checks guardian permission again. Earlier records keep their original age band.')}</p>}
      </div>}
    </>}
    {saved&&<p role="status" className="notice">{saved}</p>}{error&&<p role="alert" className="notice error">{error}</p>}
  </section>;
}
