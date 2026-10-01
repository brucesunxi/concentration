import {useEffect,useState} from 'react';
import type {Locale} from '../../../packages/task-engine/index.ts';
import type {RecoveryItem} from '../../../packages/session-runtime/recovery-model.ts';
import {useRecovery} from '../../../packages/session-runtime/useRecovery.ts';
import {recoveryCopy} from '../../../packages/session-runtime/recovery-copy.ts';
import {translate,taskContent} from './content.ts';
import {request,deviceId} from './api.ts';
const device=async()=>deviceId(),uuid=()=>crypto.randomUUID();
export default function Recovery({childId,locale,onResume,onRequireLogin}:{childId:string;locale:Locale;onResume(id:string):Promise<void>;onRequireLogin():void}){
 const t=translate(locale),{state,reload,handover,resume}=useRecovery(childId,request,device,uuid),[confirmed,setConfirmed]=useState(false);
 const data=state.data,active=data?.active;
 useEffect(()=>setConfirmed(false),[active?.etag,state.saved,state.error]);
 const description=(item:RecoveryItem)=><><h3>{taskContent(item.task,locale).title}</h3><p>{new Date(item.createdAt).toLocaleString(locale)} · {item.sameDevice?t('此设备','This device'):t('另一台设备','Another device')} · {item.environment?.platform ?? t('旧版','Legacy')}</p><p>{t(`服务端已收到 ${item.receivedEvents} 条操作记录，不代表所有本机记录都已上传。`, `The service has received ${item.receivedEvents} events. This may not include everything saved on the device.`)}</p>{item.uploadUntil&&<p className="subtle">{t('补传截止：','Upload deadline: ')}{new Date(item.uploadUntil).toLocaleString(locale)}</p>}{item.mayResume===false&&<p className="notice">{t('这次旧练习的开放范围已改变，不能恢复或补传；本机记录仍可导出。','The release scope for this earlier practice changed. It cannot resume or upload; local records remain exportable.')}</p>}</>;
 const resumeButton=(item:RecoveryItem)=>item.sameDevice&&!item.finalized&&<button className="quiet" disabled={state.busy||!data?.collectionActive||item.mayResume===false} onClick={()=>void resume(item,onResume)}>{item.historyOnly?t('恢复本机记录并补传','Recover and upload local records'):t('回到此设备的练习','Resume on this device')}</button>;
 return <section className="family-card" aria-labelledby="recovery-title"><h2 id="recovery-title">{t('未结束练习与换设备','Unfinished practice & changing devices')}</h2>
 <p>{t('先在原设备结束并同步，是保留记录最直接的方式。原设备不在身边时，家长可以结束旧练习，之后补传的记录会单独保存。有剩余额度时，可以开始新练习。','Ending and syncing on the original device is the simplest way to preserve the record. If it is unavailable, a parent can end the old practice. Later uploads stay separate; new practice uses the remaining daily allowance.')}</p>
 <button className="quiet" disabled={state.busy} onClick={()=>void reload()}>{t('刷新状态','Refresh status')}</button>
 {state.busy&&<p role="status">{t('正在确认记录…','Checking records…')}</p>}
 {state.saved&&<p className="notice" role="status">{t('旧练习已结束。已有记录可以单独补传，不计入课程。','The old practice has ended. Saved records may still be uploaded separately without changing the course.')}</p>}
 {state.error&&<div className="notice error" role="alert"><p>{recoveryCopy(locale,state.error)}</p>{['REAUTH_REQUIRED','UNAUTHENTICATED','PARENT_REQUIRED'].includes(state.error)&&<button className="quiet" onClick={onRequireLogin}>{t('验证家长密码','Verify parent password')}</button>}</div>}
 {data&&<><p className="subtle">{data.budgetDay} · {data.timezone} · {t(`尚未分配的练习额度约 ${Math.floor(data.availableMs/60000)} 分钟。`,`About ${Math.floor(data.availableMs/60000)} minutes of unallocated practice allowance.`)}</p>
 {!data.collectionActive&&<p className="notice">{t('此档案已停止采集。','Collection has stopped for this profile.')}</p>}
 {data.marketOpen===false&&<p className="notice">{t('当前地区、年龄或语言尚未开放新练习。已有记录仍可从资料入口导出。','New practices are unavailable for this region, age or language. Existing records can still be exported.')}</p>}
 {active?<article className="stack-form">{description(active)}{resumeButton(active)}
 {active.handoverAvailable?<><h3>{t('由家长结束旧设备的练习','End the old device’s practice as a parent')}</h3><p>{t('旧设备断网时无法立即收到通知。原设备确认完整补传和结束前，当天额度会继续预留；确认后释放未用部分。若原设备无法确认且没有剩余额度，今天先休息，明天再开始。旧记录不与新练习合并，也不再推进课程或调整难度。','An offline device cannot receive this change immediately. Its allowance stays reserved until the original device confirms upload and closure, which releases the unused part. If that is unavailable and no allowance remains, take a break today and start tomorrow. Old records stay separate and will not advance the course or change difficulty.')}</p><label className="check-label"><input type="checkbox" checked={confirmed} disabled={state.busy||!data.collectionActive} onChange={e=>setConfirmed(e.target.checked)} />{t('我已了解额度与旧记录的处理方式，确认结束这份旧练习。','I understand the allowance and record handling, and confirm ending this old practice.')}</label><button className="primary" disabled={!confirmed||state.busy||!data.collectionActive} onClick={()=>void handover(active)}>{t('确认结束旧练习','Confirm ending old practice')}</button></>:<p>{t('这份旧版练习需要在原设备结束。','This legacy practice must be ended on the original device.')}</p>}</article>:<p role="status">{t('当前没有未结束的练习。可以回到首页查看下一步。','There is no unfinished practice. Return home to choose your next step.')}</p>}
 {!!data.history.length&&<><h3>{t('换设备前的独立记录','Previous-device records')}</h3><p className="subtle">{t('显示最近 20 份；全部记录可从资料入口导出。','Showing the latest 20. Export all records through the data tools.')}</p>{data.history.map(item=><article className="family-card" key={item.id}>{description(item)}<p>{item.finalized?t('已经核对保存，不计入课程或周回顾比较。','Confirmed and saved; excluded from the course and weekly comparisons.'):t('等待原设备补传或确认结束。','Awaiting upload or closure from the original device.')}</p>{resumeButton(item)}</article>)}</>}
 </>}
 </section>;
}
