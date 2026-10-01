import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { GoalInput } from '../../../packages/family-support/model.ts';
import type { LifeRequest } from '../../../packages/family-support/client.ts';
import { contentLabel } from '../../../packages/family-support/publication-copy.ts';
import { useParentGuide } from '../../../packages/family-support/useParentGuide.ts';
import { guideCopy as copy, guideError, guideProgress } from '../../../packages/family-support/parent-guide-copy.ts';
import type { MobileClient } from './client';
import { Page, Button, Notice, s } from './ui';
import { translate } from '../../../packages/content/copy.ts';

export function ParentGuide({ childId, locale, client, onBack, onLife, onLogin, canChooseGoal = true }: {
  canChooseGoal?: boolean; childId: string; locale: Locale; client: MobileClient; onBack(): void;
  onLife(template: GoalInput['templateId']): void; onLogin(): void;
}) {
  const request = useMemo<LifeRequest>(() => (path, method, data, headers) => client.request(path, method, data, headers), [client]);
  const { state, reload } = useParentGuide(childId, request), [chosen, setChosen] = useState<number | null>(null), [topics, setTopics] = useState(false);
  const { data, busy, error } = state, t = translate(locale), lesson = data?.lessons.find(item => item.stage === (chosen ?? data.recommended));
  return <Page title={copy.title[locale]} subtitle={copy.subtitle[locale]}>
    <Button quiet title={t('返回家庭空间', 'Back to family space')} onPress={onBack} />
    {data&&<Notice>{contentLabel(data.content,locale)}</Notice>}<Text style={s.muted}>{copy.pace[locale]}</Text>
    <Notice>{guideError(error, locale)}</Notice>
    {['UNAUTHENTICATED', 'PARENT_REQUIRED', 'ACCESS_CHANGED'].includes(error) && <Button title={t('重新验证家长身份', 'Sign in as a parent')} onPress={onLogin} />}
    <Button quiet title={copy.refresh[locale]} disabled={busy} onPress={() => void reload()} />
    {busy && !data && <Text accessibilityLiveRegion="polite" style={s.muted}>{copy.loading[locale]}</Text>}
    {data && lesson && <>
      <Text style={s.body} accessibilityLiveRegion="polite">{guideProgress(data, locale)}</Text>
      {!data.collectionActive && <Notice>{copy.stopped[locale]}</Notice>}
      <Button quiet title={topics ? t('收起主题', 'Hide topics') : copy.chapters[locale]} onPress={() => setTopics(!topics)} />
      {topics && <View style={s.card}>{data.lessons.map(item => <Button key={item.stage} quiet={item.stage !== lesson.stage} title={`${item.stage === 0 ? t('准备', 'Start') : item.stage} · ${item.title[locale]}${item.stage === data.recommended ? t(' · 当前建议', ' · Current suggestion') : ''}`} onPress={() => { setChosen(item.stage); setTopics(false); }} />)}</View>}
      {lesson.stage !== data.recommended && <Button quiet title={copy.recommended[locale]} onPress={() => setChosen(null)} />}
      <View style={s.card}>
        <Text style={s.muted}>{data.ageBand}{t(' 岁 · 陪伴示例', ' years · Parent example')}</Text>
        <Text accessibilityRole="header" style={s.heading}>{lesson.title[locale]}</Text>
        <Text style={s.label}>{copy.purpose[locale]}</Text><Text style={s.body}>{lesson.purpose[locale]}</Text>
        <Text style={s.label}>{copy.invitation[locale]}</Text><Notice>{lesson.invitation[locale]}</Notice>
        <Text style={s.label}>{copy.example[locale]}</Text><Text style={s.body}>{lesson.example[locale]}</Text>
        <Text style={s.label}>{copy.steps[locale]}</Text>{lesson.steps.map((step, i) => <Text key={i} style={s.body}>{i + 1}. {step[locale]}</Text>)}
        <Text style={s.label}>{copy.fallback[locale]}</Text><Text style={s.body}>{lesson.fallback[locale]}</Text>
        <Text style={s.label}>{copy.notice[locale]}</Text><Text style={s.body}>{lesson.notice[locale]}</Text>
        {canChooseGoal && lesson.templateId ? <><Text style={s.muted}>{copy.lifeHint[locale]}</Text><Button disabled={busy || !data.collectionActive} title={copy.life[locale]} onPress={() => onLife(lesson.templateId!)} /></> : <Text style={s.muted}>{copy.beforeStart[locale]}</Text>}
      </View>
    </>}
  </Page>;
}
