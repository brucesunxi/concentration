import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text } from 'react-native';
import type { Child } from '../../../packages/contracts/models.ts';
import type { PracticeStartReview } from '../../../packages/contracts/index.ts';
import type { TaskId } from '../../../packages/task-engine/index.ts';
import { practiceInvitationCopy, practiceInvitationDay, practiceInvitationRefreshCopy, practiceStartReview } from '../../../packages/contracts/practice-invitation.ts';
import { usePracticeLimits } from '../../../packages/session-runtime/usePracticeLimits.ts';
import { taskContent, translate } from '../../../packages/content/copy.ts';
import type { MobileClient } from './client';
import { Button, Notice, Page, s } from './ui';

const isActive = () => AppState.currentState === 'active';
export function PracticeInvitation({ child, task, client, canEdit, parentPresent, pending, error, onBegin, onClose, onPlan }: {
  child: Child; task: TaskId; client: MobileClient; canEdit: boolean; parentPresent: boolean; pending: boolean; error: string;
  onBegin(review: PracticeStartReview): void; onClose(): void; onPlan(): void;
}) {
  const request = useCallback(<T,>(path: string, method?: string, data?: unknown, headers?: Record<string, string>) => client.request<T>(path, method, data, headers), [client]);
  const { state, refresh } = usePracticeLimits(child.id, canEdit, request, isActive);
  const [changed, setChanged] = useState(false), previous = useRef<string | null>(null);
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
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => listener.remove();
  }, [refresh]);
  return <Page title={c.title} subtitle={taskContent(task, child.locale, child.ageBand).title}>
    <Text style={s.body}>{c.body}</Text>
    {state.busy && <Text accessibilityLiveRegion="polite" style={s.body}>{update.loading}</Text>}
    <Notice>{state.error && update.failed}</Notice>
    {profileChanged && <Notice>{t('档案已更新，请返回家庭空间重新选择。', 'This profile has updated. Return to your family space and choose again.')}</Notice>}
    {changed && !state.stale && <Notice>{update.changed}</Notice>}
    <Notice>{day?.message}</Notice>
    {parentPresent && <Text style={s.muted}>{c.parentHint}</Text>}
    <Notice>{error}</Notice>
    <Button title={c.begin} disabled={unavailable} onPress={() => { if (review && !unavailable) onBegin(review); }} />
    <Button quiet title={c.later} disabled={pending} onPress={onClose} />
    <Button quiet title={update.refresh} disabled={pending || state.busy} onPress={() => void refresh()} />
    {day && !day.mayStart && <Button quiet title={t('查看今天的安排', 'View today’s plan')} onPress={onPlan} />}
  </Page>;
}
