import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Child } from '../../../packages/contracts/models.ts';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { taskContent } from '../../../packages/content/copy.ts';
import { teenStrategyCopy } from '../../../packages/contracts/teen-strategy-copy.ts';
import { TeenStrategyHistoryClient, initialTeenStrategyState } from '../../../packages/session-runtime/teen-strategy-history-client.ts';
import type { MobileClient } from './client';
import { Button, Notice, Page, s, colors } from './ui';

export function TeenStrategyHistory({ child, locale, client, onBack, onAccessEnded }: { child: Child; locale: Locale; client: MobileClient; onBack(): void; onAccessEnded(): void }) {
  const [state, setState] = useState(initialTeenStrategyState);
  const history = useRef<TeenStrategyHistoryClient | null>(null);
  const copy = teenStrategyCopy(locale);
  useEffect(() => {
    const current = new TeenStrategyHistoryClient(child.id, path => client.request(path), setState);
    history.current = current; void current.refresh();
    return () => { current.dispose(); history.current = null; };
  }, [child.id, client]);
  useEffect(() => { if (state.denied) onAccessEnded(); }, [state.denied]);
  return <Page title={copy.title} subtitle={copy.introduction}>
    <Button quiet title={copy.back} onPress={onBack} />
    <Text style={s.muted}>{copy.familyNote}</Text>
    {state.busy && <ActivityIndicator accessibilityLabel={copy.loading} color={colors.accent} />}
    <Notice>{state.error ? state.denied ? copy.denied : copy.error : ''}</Notice>
    {state.error && !state.data && !state.denied && <Button quiet title={copy.retry} onPress={() => void history.current?.refresh()} />}
    {state.data && <>
      {!state.data.items.length && <Notice>{copy.empty}</Notice>}
      {state.data.items.map(item => {
        const content = taskContent(item.task, locale, child.ageBand);
        return <View key={item.id} style={s.card}><Text style={s.muted}>{new Date(item.createdAt).toLocaleDateString(locale)} · {copy.status(item.status)}</Text><Text accessibilityRole="header" style={s.heading}>{content.skill}</Text><Text style={s.body}>{content.title}</Text><Text style={s.muted}>{copy.currentSuggestion} · {content.strategy}</Text></View>;
      })}
      <Text accessibilityLiveRegion="polite" style={s.muted}>{copy.page(state.page)}</Text>
      <View style={s.row}><Button quiet title={copy.newer} disabled={state.busy || state.page === 1} onPress={() => void history.current?.newer()} /><Button quiet title={copy.older} disabled={state.busy || !state.data.nextCursor} onPress={() => void history.current?.older()} /></View>
    </>}
  </Page>;
}
