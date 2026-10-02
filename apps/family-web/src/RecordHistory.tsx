import { useEffect, useRef, useState } from 'react';
import { BarChart3, Leaf, Download, Plus, Target, PauseCircle, Layers3, Sparkles } from 'lucide-react';
import type { Child } from './api.ts';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { HistoryKind } from '../../../packages/contracts/history.ts';
import { HistoryClient, initialHistoryState } from '../../../packages/session-runtime/history-client.ts';
import { historyCopy } from '../../../packages/session-runtime/history-copy.ts';
import { request } from './api.ts';
import { taskContent, translate } from './content.ts';
import { WeeklyReview } from './WeeklyReview.tsx';
import './record-history.css';
const taskIcons = { search: Target, stop: PauseCircle, memory: Layers3, sustain: Sparkles };
interface Props { child:Child; locale:Locale; owner:boolean; revision:number; onExport():void; onObserve():void; onRequireParent():void }
export default function RecordHistory({child,locale,owner,revision,onExport,onObserve,onRequireParent}:Props) {
  const [state,setState]=useState(initialHistoryState), client=useRef<HistoryClient|null>(null);
  const parent=useRef(onRequireParent); parent.current=onRequireParent;
  const sessionHeading=useRef<HTMLHeadingElement>(null),observationHeading=useRef<HTMLHeadingElement>(null),pendingFocus=useRef<HistoryKind|null>(null);
  const t=translate(locale),copy=historyCopy(locale),report=state.data;
  useEffect(()=>{const c=new HistoryClient(child.id,request,setState);client.current=c;setState(initialHistoryState());void c.refresh();return()=>c.dispose();},[child.id,revision]);
  useEffect(()=>{if(state.needsParent)parent.current();},[state.needsParent]);
  useEffect(()=>{if(!state.busy&&pendingFocus.current){if(!state.error){const h=pendingFocus.current==='sessions'?sessionHeading.current:observationHeading.current;h?.focus({preventScroll:true});h?.scrollIntoView({block:'start'});}pendingFocus.current=null;}},[state]);
  function pager(kind:HistoryKind) { if(!report)return null;return <nav className="history-pages" aria-label={t(kind==='sessions'?'练习记录翻页':'生活观察翻页',kind==='sessions'?'Practice history pages':'Observation history pages')}>
    <p role="status">{state.busy&&state.target===kind?copy.loading:copy.page(state.pages[kind],report[kind].length)}</p>
    {state.error&&state.target===kind&&<p className="notice error" role="alert">{copy.error(state.error)}</p>}<div>
    <button className="quiet" disabled={state.busy||state.pages[kind]===1} onClick={()=>{pendingFocus.current=kind;void client.current?.move(kind,'newer');}}>{copy.newer(kind)}</button>
    <button className="quiet" disabled={state.busy||!report.history[kind].nextCursor} onClick={()=>{pendingFocus.current=kind;void client.current?.move(kind,'older');}}>{copy.older(kind)}</button></div>
    {!report.history[kind].nextCursor&&report[kind].length>0&&<p className="subtle">{copy.end}</p>}
  </nav>; }
  if(state.needsParent)return <p role="status">{t('请重新验证家长身份后查看记录。','Verify your parent identity again to view records.')}</p>;
  return <>
    <div className="history-intro"><p className="subtle">{copy.explanation}</p>{owner&&<p className="subtle">{t('导出包含家庭服务记录，并会尝试附上此浏览器仍保留的恢复日志；其他设备的日志不在其中。','The export includes server records and attempts to add recovery logs still held in this browser. Logs on other devices are not included.')}</p>}<button className="quiet" disabled={state.busy} onClick={()=>{pendingFocus.current='sessions';void client.current?.refresh();}}>{copy.refresh}</button></div>
    {state.error&&!state.target&&<p className="notice error" role="alert">{copy.error(state.error)}</p>}
    {state.busy&&!state.target&&report&&<p role="status">{copy.loading}</p>}
        <WeeklyReview key={child.id} childId={child.id} locale={locale} revision={report?.observationCount ?? 0} onRequireParent={onRequireParent} />
        <div className="report-banner"><div><span className="eyebrow">{child.alias} · {t('只和自己的同类练习比较', 'Compare like-for-like practice')}</span><h2>{t('记录过程，不定义孩子', 'A record of practice, not a label')}</h2><p>{t('不同任务、不同难度和使用提示的记录分开看。游戏表现并不等于生活中的变化。', 'Look separately at tasks, difficulty and help used. A game result is not the same as change in everyday life.')}</p></div><BarChart3 size={52} /></div>
        {!report ? (state.busy ? <p role="status">{copy.loading}</p> : null) : <><div className="report-stats"><div><strong>{report.child.completedSessions}</strong><span>{t('完整练习', 'Completed practices')}</span></div><div><strong>{report.observationCount}</strong><span>{t('生活记录', 'Everyday observations')}</span></div><div><strong>{report.child.course.week}</strong><span>{t('当前课程周', 'Current course week')}</span></div></div><div className="section-title"><h2 ref={sessionHeading} tabIndex={-1}>{t('每一次具体的尝试', 'Each specific attempt')}</h2>{owner&&<button className="quiet" onClick={() => onExport()}><Download size={16} />{t('导出记录', 'Export records')}</button>}</div>{!report.sessions.length ? <div className="empty-state small"><Leaf size={30} /><h3>{t('第一条记录，等你慢慢开始', 'Your first record will come in time')}</h3><p>{t('先一起理解规则，再完成一段短练习。', 'Understand the rule together, then try a short practice.')}</p></div> : <div className="record-list">{report.sessions.map(s => {
  const r = s.result, content = taskContent(r.task, locale, child.ageBand), Icon = taskIcons[r.task];
  const assistive = r.environment?.input === 'assistive', formalSteps = r.metrics.trials + r.metrics.assisted;
  const status = r.historyOnly ? t('换设备前记录 · 不计入课程', 'Previous-device record · Not counted in the course') : r.completed ? t('完整尝试', 'Completed') : formalSteps === 0 ? t('提前结束 · 尚无正式步骤', 'Stopped early · No formal step completed') : t('提前结束', 'Stopped early');
  return <article className="record-card" key={s.id}>
    <div className={`record-icon ${content.color}`}><Icon size={22} /></div>
    <div>
      <h3>{content.title}<span className="pill neutral">{status}</span>{assistive && <span className="pill neutral">{t('读屏方式 · 单独记录', 'Screen reader · separate record')}</span>}</h3>
      <p>{new Date(s.created_at).toLocaleString(locale)} · {r.condition.split(':').at(-1)}{t(' 级', ' level')}</p>
      <small>{assistive ? t(`读屏正式步骤 ${formalSteps} 个 · 帮助 ${r.metrics.assisted} 次`, `${formalSteps} formal screen reader steps · ${r.metrics.assisted} with help`) : t(`独立有效步骤 ${r.metrics.trials} 个 · 帮助 ${r.metrics.assisted} 次`, `${r.metrics.trials} independent steps · ${r.metrics.assisted} with help`)} · {t('中断重做', 'Interrupted')}: {r.interruptions} · {t('排除或重做记录', 'Excluded or repeated')}: {r.invalidations?.length ?? r.interruptions}</small>
    </div>
    <div className="record-outcome">{assistive ? <><strong>{formalSteps}</strong><span>{t('单独保留，不计算正确率或能力变化', 'Kept separately; no accuracy or ability change calculated')}</span></> : <>{r.metrics.trials === 0 ? <strong>{t('尚无独立步骤', 'No independent steps yet')}</strong> : r.metrics.trials < 12 ? <strong>{t('继续积累', 'Building a record')}</strong> : <strong>{r.metrics.correct}/{r.metrics.trials}</strong>}<span>{r.metrics.trials < 12 ? t('样本还少，不作能力判断', 'A small sample, not an ability rating') : t('本次独立步骤正确数', 'Correct independent steps')}</span></>}</div>
  </article>;
})}</div>}{pager('sessions')}<div className="section-title"><h2 ref={observationHeading} tabIndex={-1}>{t('生活中的小变化', 'Everyday observations')}</h2><button className="quiet" onClick={onObserve}><Plus size={16} />{t('记一次', 'Add one')}</button></div><div className="observations">{report.observations.length ? report.observations.map(o => <article key={o.id}><Leaf size={19} /><div><strong>{({ packing: t('准备物品', 'Getting things ready'), tidying: t('整理小空间', 'Tidying a space'), reading: t('短段阅读', 'A little reading'), project: t('个人小项目', 'A small project') } as Record<string, string>)[o.context]}</strong><p>{t(`提醒 ${o.prompts} 次`, `${o.prompts} reminders`)} · {o.child_choice ? t('孩子自己选择', 'Chosen by the child') : t('一起商量选择', 'Chosen together')}</p></div><time>{new Date(o.created_at).toLocaleDateString(locale)}</time></article>) : <p className="subtle">{t('记录具体的任务和提醒次数，不急着下结论。', 'Record the task and reminders without rushing to a conclusion.')}</p>}</div>{pager('observations')}</>}
  </>;
}
