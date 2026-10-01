import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { usePracticeLimits } from '../../../packages/session-runtime/usePracticeLimits.ts';
import { limitCopy } from '../../../packages/session-runtime/practice-limit-copy.ts';
import type { MobileClient } from './client';
import { Page, Button, Choice, CheckBox, Notice, s } from './ui';

export function PracticeLimits({ childId, parent, locale, client, onBack, onParent, onLife, onRecovery, allowLife = true, support = false }: { allowLife?: boolean; support?: boolean; childId: string; parent: boolean; locale: Locale; client: MobileClient; onBack(): void; onParent(): void; onLife(): void; onRecovery(): void }) {
  const request = useCallback(<T,>(path: string, method?: string, data?: unknown, headers?: Record<string, string>) => client.request<T>(path, method, data, headers), [client]);
  const { state, reload, save } = usePracticeLimits(childId, parent, request), c = limitCopy(locale), data = state.data;
  const [minutes, setMinutes] = useState(0), [ack, setAck] = useState(false);
  useEffect(() => { if (data) setMinutes(data.next?.minutes ?? data.currentMinutes); setAck(false); }, [data]);
  return <Page title={c.title} subtitle={c.intro}>
    <Notice>{state.error && c.error(state.error)}</Notice>{state.saved && <Notice>{c.saved}</Notice>}
    {state.busy && !data && <Text accessibilityLiveRegion="polite" style={s.body}>{c.loading}</Text>}
    {data && <>
      <Text style={s.muted}>{c.date(data.day, data.timezone)}</Text><View style={s.card}><Text style={s.heading}>{c.today}</Text><Text style={s.heading}>{data.currentMinutes ? `${c.maximum} ${c.minutes(data.currentMinutes)}` : c.paused}</Text><Text style={s.body}>{c.status(data.status)}</Text><Text style={s.body}>{c.pending(data)}</Text></View>
      {parent && <View style={s.card}><Text style={s.body}>{c.confirmed}: {c.duration(data.confirmedMs)}</Text><Text style={s.body}>{c.reserved}: {c.duration(data.reservedMs)}</Text><Text style={s.body}>{c.remaining}: {c.duration(data.availableMs)}</Text></View>}
      <Text style={s.muted}>{c.scope}</Text>
      {parent && data.collectionActive ? <View style={s.card}><Text style={s.heading}>{c.edit}</Text><Text style={s.body}>{c.ceiling(data.maximumMinutes)}</Text><Text style={s.body}>{c.timing(data.nextDay)}</Text><Text style={s.label}>{c.choice}</Text>
        <View style={s.row}>{Array.from({ length: data.maximumMinutes + 1 }, (_, n) => <Choice key={n} label={n ? c.minutes(n) : c.paused} selected={minutes === n} disabled={state.busy} onPress={() => { setMinutes(n); setAck(false); }} />)}</View>
        <CheckBox label={c.ack} value={ack} onChange={setAck} disabled={state.busy} /><Button title={state.busy ? c.busy : c.save} disabled={state.busy || !ack || minutes === (data.next?.minutes ?? data.currentMinutes)} onPress={() => { setAck(false); void save(minutes); }} />
      </View> : !parent && <Text style={s.body}>{support ? (locale === 'en' ? 'The family creator manages this plan. You can view it here.' : '此安排由家庭创建者管理，你可以在这里查看。') : c.child}</Text>}
      <Text style={s.muted}>{c.preview}</Text>
    </>}
    <Button quiet title={c.reload} disabled={state.busy} onPress={() => void reload()} />{state.needsParent && <Button title={c.login} onPress={onParent} />}{allowLife && <Button quiet title={c.life} onPress={onLife} />}{parent && data && data.reservedMs > 0 && <Button quiet title={c.recovery} onPress={onRecovery} />}<Button quiet title={c.back} disabled={state.busy} onPress={onBack} />
  </Page>;
}
