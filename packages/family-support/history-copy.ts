import type { Locale } from '../task-engine/index.ts';
export function lifeHistoryCopy(locale:Locale) {
  const t=(zh:string,en:string)=>locale==='en'?en:zh;
  return {
    refresh:t('读取最新目标与记录','Read the latest goal and records'),
    explanation:(total:number)=>t(`共 ${total} 个目标。当前目标显示在上方；已结束的尝试按创建时间从新到旧排列，每页最多 20 个。生活回顾不计入游戏成绩。`,`${total} goals in total. The current goal stays above. Closed attempts appear by creation date, newest first, up to 20 per page. Reflections do not change practice scores.`),
    page:(page:number,count:number)=>t(`第 ${page} 页 · 本页 ${count} 个已结束目标`,`Page ${page} · ${count} closed goals on this page`),
    older:t('更早的小尝试','Older attempts'),newer:t('返回上一页尝试','Previous page of attempts'),
    loading:t('正在读取这一页…','Loading this page…'),
    end:t('已到当前可查看的最早尝试。','You have reached the oldest attempts currently available.'),
    empty:t('这一页没有已结束的小目标。可以查看最新记录或返回上一页。','There are no closed goals on this page. Read the latest records or return to the previous page.'),
    navigation:t('生活目标历史翻页','Everyday goal history pages'),
  };
}
