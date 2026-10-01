import { useRef, useState } from 'react';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { GoalInput } from '../../../packages/family-support/model.ts';
import { contentLabel } from '../../../packages/family-support/publication-copy.ts';
import { useParentGuide } from '../../../packages/family-support/useParentGuide.ts';
import { guideCopy as copy, guideError, guideProgress } from '../../../packages/family-support/parent-guide-copy.ts';
import { request } from './api.ts';
import { translate } from './content.ts';
import './parent-guide.css';

export default function ParentGuide({ childId, locale, onLife, onLogin, canChooseGoal = true }: {
  canChooseGoal?: boolean; childId: string; locale: Locale; onLife(template: GoalInput['templateId']): void; onLogin(): void;
}) {
  const { state, reload } = useParentGuide(childId, request), [chosen, setChosen] = useState<number | null>(null), [topics, setTopics] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), t = translate(locale), { data, busy, error } = state;
  const lesson = data?.lessons.find(item => item.stage === (chosen ?? data.recommended));
  function select(stage: number | null) { setChosen(stage); setTopics(false); requestAnimationFrame(() => heading.current?.focus()); }
  return <section className="parent-guide" aria-busy={busy}>
    <header><h2>{copy.title[locale]}</h2><p>{copy.subtitle[locale]}</p></header>
    {data&&<p className="notice">{contentLabel(data.content,locale)}</p>}
    <p className="subtle">{copy.pace[locale]}</p>
    {error && <div className="notice error" role="alert"><p>{guideError(error, locale)}</p>{['UNAUTHENTICATED', 'PARENT_REQUIRED', 'ACCESS_CHANGED'].includes(error) && <button className="quiet" onClick={onLogin}>{t('重新验证家长身份', 'Sign in as a parent')}</button>}</div>}
    <button className="quiet" disabled={busy} onClick={() => void reload()}>{copy.refresh[locale]}</button>
    {busy && !data && <p role="status">{copy.loading[locale]}</p>}
    {data && lesson && <>
      <p className="guide-progress" role="status">{guideProgress(data, locale)}</p>
      {!data.collectionActive && <p className="notice">{copy.stopped[locale]}</p>}
      <div className="guide-layout">
        <button className="quiet guide-topic-toggle" aria-expanded={topics} aria-controls="guide-topics" onClick={() => setTopics(!topics)}>{topics ? t('收起主题', 'Hide topics') : copy.chapters[locale]}</button>
        <nav id="guide-topics" className={`guide-chapters ${topics ? 'topics-open' : ''}`} aria-label={copy.chapters[locale]}>
          <h3>{copy.chapters[locale]}</h3>
          {data.lessons.map(item => <button key={item.stage} className={item.stage === lesson.stage ? 'selected' : ''} aria-current={item.stage === lesson.stage ? 'step' : undefined} onClick={() => select(item.stage)}><span>{item.stage === 0 ? t('准备', 'Start') : String(item.stage).padStart(2, '0')}</span><strong>{item.title[locale]}</strong>{item.stage === data.recommended && <small>{t('当前建议', 'Current suggestion')}</small>}</button>)}
        </nav>
        <article className="guide-lesson">
          <div className="guide-lesson-label"><span className="pill neutral">{data.ageBand}{t(' 岁 · 陪伴示例', ' years · Parent example')}</span>{lesson.stage !== data.recommended && <button className="text-button" onClick={() => select(null)}>{copy.recommended[locale]}</button>}</div>
          <h2 ref={heading} tabIndex={-1}>{lesson.title[locale]}</h2>
          <h3>{copy.purpose[locale]}</h3><p>{lesson.purpose[locale]}</p>
          <aside className="guide-invitation"><h3>{copy.invitation[locale]}</h3><p>{lesson.invitation[locale]}</p></aside>
          <h3>{copy.example[locale]}</h3><p>{lesson.example[locale]}</p>
          <h3>{copy.steps[locale]}</h3><ol>{lesson.steps.map((step, i) => <li key={i}>{step[locale]}</li>)}</ol>
          <h3>{copy.fallback[locale]}</h3><p>{lesson.fallback[locale]}</p>
          <h3>{copy.notice[locale]}</h3><p>{lesson.notice[locale]}</p>
          {canChooseGoal && lesson.templateId ? <div className="guide-next"><p>{copy.lifeHint[locale]}</p><button className="primary" disabled={busy || !data.collectionActive} onClick={() => onLife(lesson.templateId!)}>{copy.life[locale]}</button></div> : <p className="subtle">{copy.beforeStart[locale]}</p>}
        </article>
      </div>
    </>}
  </section>;
}
