import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { Child } from '../../../packages/contracts/models.ts';
import type { PracticeStartReview } from '../../../packages/contracts/index.ts';
import type { TaskId } from '../../../packages/task-engine/index.ts';
import { practiceInvitationCopy, practiceInvitationDay, practiceInvitationRefreshCopy, practiceStartReview } from '../../../packages/contracts/practice-invitation.ts';
import { usePracticeLimits } from '../../../packages/session-runtime/usePracticeLimits.ts';
import { taskContent, translate } from './content.ts';
import { request } from './api.ts';

const isActive = () => !document.hidden;
export default function PracticeInvitation({ child, task, canEdit, parentPresent, pending, onBegin, onClose, onPlan }: {
  child: Child; task: TaskId; canEdit: boolean; parentPresent: boolean; pending: boolean;
  onBegin(review: PracticeStartReview, mode: 'standard' | 'assistive', event: MouseEvent<HTMLButtonElement>): void;
  onClose(): void; onPlan(): void;
}) {
  const { state, refresh } = usePracticeLimits(child.id, canEdit, request, isActive);
  const [inputMode, setInputMode] = useState<'standard' | 'assistive' | null>(null), [changed, setChanged] = useState(false);
  const previous = useRef<string | null>(null);
  const data = state.data, c = practiceInvitationCopy(child.ageBand, child.locale), update = practiceInvitationRefreshCopy(child.locale), t = translate(child.locale);
  const review = data ? practiceStartReview(data, child.locale) : null;
  const signature = review ? JSON.stringify(review) : null;
  const day = data && !state.stale ? practiceInvitationDay(data, child.locale) : null;
  const profileChanged = !!data && data.ageBand !== child.ageBand;
  const unavailable = pending || state.busy || state.stale || profileChanged || !day?.mayStart;
  useEffect(() => {
    if (signature && previous.current && signature !== previous.current) setChanged(true);
    if (signature) previous.current = signature;
  }, [signature]);
  useEffect(() => {
    const visible = () => { if (isActive()) void refresh(); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
  }, [refresh]);
  return <div className="practice-invitation" lang={child.locale}>
    <p className="practice-invitation-task">{taskContent(task, child.locale, child.ageBand).title}</p>
    <p>{c.body}</p>
    {state.busy && <p role="status">{update.loading}</p>}
    {state.error && <p className="notice error" role="alert">{update.failed}</p>}
    {profileChanged && <p className="notice" role="alert">{t('档案已更新，请返回家庭空间重新选择。', 'This profile has updated. Return to your family space and choose again.')}</p>}
    {changed && !state.stale && <p className="notice" role="status">{update.changed}</p>}
    {day?.message && <p className="notice" role="status">{day.message}</p>}
    {parentPresent && <p className="subtle">{c.parentHint}</p>}
    <fieldset className="practice-input-choice" disabled={pending || state.busy || state.stale}>
      <legend>{t('这次怎样操作？', 'How will you use this practice?')}</legend>
      <label><input type="radio" name="practice-input-mode" checked={inputMode === 'standard'} onChange={() => setInputMode('standard')} />{t('普通触屏、鼠标或键盘', 'Touch, mouse or keyboard')}</label>
      <label><input type="radio" name="practice-input-mode" checked={inputMode === 'assistive'} disabled={['stop', 'sustain'].includes(task)} onChange={() => setInputMode('assistive')} />{t('读屏操作（单独记录）', 'Screen reader (recorded separately)')}</label>
      <p className="subtle">{['stop', 'sustain'].includes(task)
        ? t('这道限时看图任务暂不支持读屏操作。可以改选“找一找”或“记一记”，也可以今天不练。', 'This timed visual task is not available with a screen reader yet. Choose Search or Memory, or stop for today.')
        : t('网页无法自动识别读屏软件。请在开始前选择；读屏记录暂不推进基础课程或自动调难度，也不与普通操作成绩比较。', 'The browser cannot detect a screen reader automatically. Choose before starting. Screen reader records do not advance the foundation course or change difficulty, and are not compared with standard input.')}</p>
    </fieldset>
    <div className="practice-invitation-actions">
      <button type="button" className="primary" disabled={unavailable || !inputMode} onClick={event => { if (review && inputMode && !unavailable) onBegin(review, inputMode, event); }}>{c.begin}</button>
      <button type="button" className="quiet" disabled={pending} onClick={onClose}>{c.later}</button>
      <button type="button" className="quiet" disabled={pending || state.busy} onClick={() => void refresh()}>{update.refresh}</button>
      {day && !day.mayStart && <button type="button" className="quiet" onClick={onPlan}>{t('查看今天的安排', 'View today’s plan')}</button>}
    </div>
  </div>;
}
