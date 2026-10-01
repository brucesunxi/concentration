import { useEffect, useState } from 'react';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { journal } from './journal.ts';

export function LocalJournalWarning({familyId,childId,locale}:{familyId:string;childId:string;locale:Locale}) {
  const [count,setCount]=useState(0),[unavailable,setUnavailable]=useState(false);
  useEffect(()=>{let live=true;
    void journal().expiringSoon(familyId,childId).then(value=>{if(live){setCount(value);setUnavailable(false);}}).catch(()=>{if(live)setUnavailable(true);});
    return()=>{live=false;};
  },[familyId,childId]);
  if(unavailable)return <p className="notice" role="status">{locale==='en'?'Local pending-record status could not be checked. Reopen this page after checking browser storage.':'无法检查本机待同步记录。请检查浏览器存储后重新打开此页。'}</p>;
  if(!count)return null;
  return <p className="notice" role="status">{locale==='en'?`${count} unsynced practice record${count===1?'':'s'} on this browser will be cleared within 24 hours. Reconnect on this device to check recovery; expired local actions cannot be restored.`:`此浏览器有 ${count} 份未同步练习记录将在 24 小时内清理。请在原设备联网查看恢复状态；过期后无法恢复这些本机操作。`}</p>;
}
