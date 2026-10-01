import type { Locale } from '../task-engine/index.ts';
import type { HistoryKind } from '../contracts/history.ts';
export function historyCopy(locale:Locale) {
  const t=(zh:string,en:string)=>locale==='en'?en:zh;
  return {
    explanation:t('按记录创建时间从新到旧查看，每页最多 50 条。补传或新保存的记录可通过“查看最新记录”重新读取。','Browse newest creation dates first, up to 50 records per page. Use “View latest records” to include newly saved or uploaded records.'),
    refresh:t('查看最新记录','View latest records'),loading:t('正在读取记录…','Loading records…'),
    page:(n:number,count:number)=>t(`第 ${n} 页 · 本页 ${count} 条`,`Page ${n} · ${count} ${count === 1 ? 'record' : 'records'} on this page`),
    older:(kind:HistoryKind)=>kind==='sessions'?t('更早的练习','Older practices'):t('更早的观察','Older observations'),
    newer:(kind:HistoryKind)=>kind==='sessions'?t('返回上一页练习','Previous page of practices'):t('返回上一页观察','Previous page of observations'),
    end:t('已到当前可查看的最早记录。','You have reached the oldest records currently available.'),
    error:(code:string)=>code==='HISTORY_UNSUPPORTED'?t('当前服务的记录格式不兼容，请更新服务后重新读取。','The service returned an incompatible record format. Update it, then reload.'):code==='INVALID_HISTORY_CURSOR'?t('翻页位置已不可用，请查看最新记录重新开始。','This page position is unavailable. View the latest records to start again.'):t('暂时无法读取。当前页码没有改变，请检查连接后重试。','Records could not be loaded. The page number has not changed. Check your connection and retry.'),
  };
}
