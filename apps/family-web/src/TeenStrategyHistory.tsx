import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import type { Child } from './api.ts';
import { request } from './api.ts';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { taskContent } from './content.ts';
import { teenStrategyCopy } from '../../../packages/contracts/teen-strategy-copy.ts';
import { TeenStrategyHistoryClient, initialTeenStrategyState } from '../../../packages/session-runtime/teen-strategy-history-client.ts';
import './teen-strategy-history.css';

export default function TeenStrategyHistory({ child, locale, onBack }: { child: Child; locale: Locale; onBack(): void }) {
  const [state, setState] = useState(initialTeenStrategyState);
  const client = useRef<TeenStrategyHistoryClient | null>(null);
  const copy = teenStrategyCopy(locale);
  useEffect(() => {
    const current = new TeenStrategyHistoryClient(child.id, request, setState);
    client.current = current; void current.refresh();
    return () => { current.dispose(); client.current = null; };
  }, [child.id]);
  return <section className="teen-strategy-history" aria-label={copy.title}>
    <button className="quiet" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />{copy.back}</button>
    <div className="teen-strategy-intro"><h2>{copy.title}</h2><p>{copy.introduction}</p><p className="subtle">{copy.familyNote}</p></div>
    {state.busy && <p role="status">{copy.loading}</p>}
    {state.error && <p className="notice error" role="alert">{state.denied ? copy.denied : copy.error}</p>}
    {state.error && !state.data && !state.denied && <button className="quiet" onClick={() => void client.current?.refresh()}><RotateCcw size={17} />{copy.retry}</button>}
    {state.data && <>
      {!state.data.items.length && <p className="notice">{copy.empty}</p>}
      <div className="teen-strategy-list">{state.data.items.map(item => {
        const content = taskContent(item.task, locale, child.ageBand);
        return <article key={item.id} className="teen-strategy-card"><div><span className="pill neutral">{copy.status(item.status)}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(locale)}</time></div><h3>{content.skill}</h3><p>{content.title}</p><p className="strategy-suggestion"><strong>{copy.currentSuggestion}</strong> · {content.strategy}</p></article>;
      })}</div>
      <nav className="teen-strategy-pages" aria-label={copy.title}><span role="status">{copy.page(state.page)}</span><div><button className="quiet" disabled={state.busy || state.page === 1} onClick={() => void client.current?.newer()}>{copy.newer}</button><button className="quiet" disabled={state.busy || !state.data.nextCursor} onClick={() => void client.current?.older()}>{copy.older}<ArrowRight size={16} aria-hidden="true" /></button></div></nav>
    </>}
  </section>;
}
