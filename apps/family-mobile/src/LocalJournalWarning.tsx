import { useEffect, useState } from 'react';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { expiringLocalJournals } from './storage';
import { Notice } from './ui';

export function LocalJournalWarning({familyId,childId,locale}:{familyId:string;childId:string;locale:Locale}) {
  const [count,setCount]=useState(0),[unavailable,setUnavailable]=useState(false);
  useEffect(()=>{let live=true;
    void expiringLocalJournals(familyId,childId).then(value=>{if(live){setCount(value);setUnavailable(false);}}).catch(()=>{if(live)setUnavailable(true);});
    return()=>{live=false;};
  },[familyId,childId]);
  if(unavailable)return <Notice>{locale==='en'?'Local pending-record status could not be checked. Unlock the device and retry.':'无法检查本机待同步记录。请解锁设备后重试。'}</Notice>;
  if(!count)return null;
  return <Notice>{locale==='en'?`${count} unsynced practice record${count===1?'':'s'} on this device will be cleared within 24 hours. Reconnect here to check recovery; expired local actions cannot be restored.`:`此设备有 ${count} 份未同步练习记录将在 24 小时内清理。请在原设备联网查看恢复状态；过期后无法恢复这些本机操作。`}</Notice>;
}
