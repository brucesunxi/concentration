import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { WeeklyReport } from '../../../packages/reports/weekly.ts';
import { weeklyPresentation } from '../../../packages/reports/presentation.ts';
import { translate } from './content.ts';
import { request, RequestError } from './api.ts';

export function WeeklyReview({ childId, locale, revision, onRequireParent }: { childId: string; locale: Locale; revision: number; onRequireParent(): void }) {
  const t = translate(locale), parent = useRef(onRequireParent); parent.current = onRequireParent;
  const [week, setWeek] = useState<string | undefined>(), [retry, setRetry] = useState(0);
  const [report, setReport] = useState<WeeklyReport | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false; setBusy(true); setError(false); setReport(null);
    void request<WeeklyReport>(`/children/${childId}/weekly${week ? `?weekStart=${encodeURIComponent(week)}` : ''}`)
      .then(value => { if (cancelled) return; if (value.childId !== childId) throw new Error('REPORT_OWNER_MISMATCH'); setReport(value); })
      .catch(e => { if (!cancelled) { setError(true); if (e instanceof RequestError && ['PARENT_REQUIRED', 'UNAUTHENTICATED'].includes(e.code)) parent.current(); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [childId, week, retry, revision]);
  const view = report ? weeklyPresentation(report, locale) : null;
  return <section className="weekly-review" aria-labelledby="weekly-heading" aria-busy={busy}>
    <div className="section-title"><h2 id="weekly-heading">{t('一起回顾这一周', 'Look back on the week together')}</h2><div className="weekly-navigation">
      <button className="quiet" disabled={busy || !report?.range.previous} onClick={() => setWeek(report!.range.previous!)}>{t('上一周', 'Previous week')}</button>
      <button className="quiet" disabled={busy} onClick={() => { setWeek(undefined); setRetry(value => value + 1); }}>{t('本周', 'This week')}</button>
      <button className="quiet" disabled={busy || !report?.range.next} onClick={() => setWeek(report!.range.next!)}>{t('下一周', 'Next week')}</button>
    </div></div>
    {busy && <p role="status">{t('正在整理已确认的记录…', 'Preparing confirmed records…')}</p>}
    {error && <div className="notice error" role="alert"><p>{t('暂时无法读取周回顾，请稍后重试。', 'This weekly review is unavailable. Please retry.')}</p><button className="quiet" onClick={() => setRetry(value => value + 1)}>{t('重试', 'Retry')}</button></div>}
    {view && <>
      <p className="weekly-date">{view.range}</p><p className="subtle">{view.subtitle}</p>
      <div className="weekly-days" aria-label={t('每日已确认记录', 'Confirmed records by day')}>{view.days.map(day => <div key={day.date}><strong>{day.date}</strong><span>{day.label}</span></div>)}</div>
      <p>{view.coverage}</p><p className="subtle">{view.missing}</p>
      {view.sections.map(section => <section className="weekly-section" key={section.key} aria-labelledby={`weekly-${section.key}`}><h3 id={`weekly-${section.key}`}>{section.title}</h3><p>{section.intro}</p>
        {section.items.length ? section.items.map(item => <article className="weekly-item" key={item.key}><h4>{item.title}</h4>{item.lines.map((line, index) => <p key={index}>{line}</p>)}{item.details && <details><summary>{t('查看比较条件', 'View comparison conditions')}</summary>{item.details.map(line => <p key={line}>{line}</p>)}</details>}</article>) : <p className="subtle">{section.empty}</p>}
      </section>)}
    </>}
  </section>;
}
