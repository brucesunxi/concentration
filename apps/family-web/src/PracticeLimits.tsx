import { useEffect, useState } from 'react';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { usePracticeLimits } from '../../../packages/session-runtime/usePracticeLimits.ts';
import { limitCopy } from '../../../packages/session-runtime/practice-limit-copy.ts';
import { request } from './api.ts';
import './practice-limits.css';

export default function PracticeLimits({ childId, parent, locale, onParent, onLife, onRecovery, allowLife = true, support = false }: { allowLife?: boolean; support?: boolean; childId: string; parent: boolean; locale: Locale; onParent(): void; onLife(): void; onRecovery(): void }) {
  const { state, reload, save } = usePracticeLimits(childId, parent, request), c = limitCopy(locale), data = state.data;
  const [minutes, setMinutes] = useState(0), [ack, setAck] = useState(false);
  useEffect(() => { if (data) setMinutes(data.next?.minutes ?? data.currentMinutes); setAck(false); }, [data]);
  return <section className="family-card practice-limits" aria-labelledby="practice-limit-title">
    <h2 id="practice-limit-title">{c.title}</h2><p>{c.intro}</p>
    {state.error && <p role="alert" className="notice error">{c.error(state.error)}</p>}
    {state.saved && <p role="status" className="notice">{c.saved}</p>}
    {state.busy && !data && <p role="status">{c.loading}</p>}
    {data && <>
      <p className="subtle">{c.date(data.day, data.timezone)}</p><div className="practice-day"><h3>{c.today}</h3><strong>{data.currentMinutes ? `${c.maximum} ${c.minutes(data.currentMinutes)}` : c.paused}</strong><p>{c.status(data.status)}</p><p>{c.pending(data)}</p></div>
      {parent && <dl className="practice-totals">{[[c.confirmed, data.confirmedMs], [c.reserved, data.reservedMs], [c.remaining, data.availableMs]].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{c.duration(Number(amount))}</dd></div>)}</dl>}
      <p className="subtle">{c.scope}</p>
      {parent && data.collectionActive ? <form className="stack-form" onSubmit={event => { event.preventDefault(); if (ack && !state.busy) { setAck(false); void save(minutes); } }}>
        <h3>{c.edit}</h3><p>{c.ceiling(data.maximumMinutes)}</p><p id="limit-timing">{c.timing(data.nextDay)}</p>
        <label>{c.choice}<select value={minutes} onChange={event => { setMinutes(Number(event.target.value)); setAck(false); }} disabled={state.busy} aria-describedby="limit-timing">{Array.from({ length: data.maximumMinutes + 1 }, (_, n) => <option value={n} key={n}>{n === 0 ? c.paused : c.minutes(n)}</option>)}</select></label>
        <label className="check-label"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} disabled={state.busy} />{c.ack}</label>
        <button className="primary" disabled={state.busy || !ack || minutes === (data.next?.minutes ?? data.currentMinutes)}>{state.busy ? c.busy : c.save}</button>
      </form> : !parent && <p>{support ? (locale === 'en' ? 'The family creator manages this plan. You can view it here.' : '此安排由家庭创建者管理，你可以在这里查看。') : c.child}</p>}
      <p className="subtle">{c.preview}</p>
    </>}
    <div className="practice-links"><button className="quiet" disabled={state.busy} onClick={() => void reload()}>{c.reload}</button>{state.needsParent && <button className="primary" onClick={onParent}>{c.login}</button>}{allowLife && <button className="quiet" onClick={onLife}>{c.life}</button>}{parent && data && data.reservedMs > 0 && <button className="quiet" onClick={onRecovery}>{c.recovery}</button>}</div>
  </section>;
}
