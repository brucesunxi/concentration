import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { AccountAction } from '../../../packages/contracts/account-security.ts';
import { newPasswordSchema } from '../../../packages/contracts/account-security.ts';
import { useAccountSecurity } from '../../../packages/session-runtime/useAccountSecurity.ts';
import { securityCopy } from '../../../packages/session-runtime/account-security-copy.ts';
import type { MobileClient } from './client';
import { Page, Button, Field, CheckBox, Notice, s } from './ui';

export function AccountSecurity({ familyId, locale, client, onBack, onSignIn }: { familyId: string; locale: Locale; client: MobileClient; onBack(): void; onSignIn(message: string): void }) {
  const request = useCallback(<T,>(path: string, method?: string, data?: unknown) => path === '/auth/change-password' || path === '/auth/logout-all'
    ? client.accountAction<T>(path.endsWith('change-password') ? 'password' : 'signout', data) : client.request<T>(path, method, data), [client]);
  const { state, reload, submit } = useAccountSecurity(familyId, request), c = securityCopy(locale,state.data?.memberRole ?? 'owner');
  const [action, setAction] = useState<AccountAction | null>(null), [current, setCurrent] = useState(''), [next, setNext] = useState(''), [repeat, setRepeat] = useState(''), [ack, setAck] = useState(false);
  function reset() { setCurrent(''); setNext(''); setRepeat(''); setAck(false); }
  const valid = !!current && ack && (action !== 'password' || (newPasswordSchema.safeParse(next).success && next === repeat));
  const outcome = state.outcome === 'password' ? c.changed : state.outcome === 'signout' ? c.signedOut : state.outcome === 'uncertain' ? c.uncertain : c.ended;
  return <Page title={c.title} subtitle={c.intro}>
    {state.outcome ? <><Notice>{outcome}</Notice><Button title={c.signin} onPress={() => onSignIn(outcome)} /></> : <>
      <Notice>{state.error && c.error(state.error)}</Notice>
      {!state.data ? <>{state.busy ? <Text accessibilityLiveRegion="polite" style={s.body}>{c.loading}</Text> : <Button title={c.retry} onPress={() => void reload()} />}</> : <>
        <View style={s.card}><Text style={s.heading}>{c.sessions}</Text><Text style={s.body}>{c.parents}: {c.browsers} {state.data.active.parent.web} · {c.apps} {state.data.active.parent.native}</Text><Text style={s.body}>{c.children}: {c.browsers} {state.data.active.child.web} · {c.apps} {state.data.active.child.native}</Text><Text style={s.muted}>{c.counts}</Text></View>
        {!action ? <><Button quiet title={c.password} onPress={() => { reset(); setAction('password'); }} /><Button quiet title={c.signout} onPress={() => { reset(); setAction('signout'); }} /></> : <View style={s.card}>
          <Text style={s.heading}>{action === 'password' ? c.password : c.signout}</Text><Text style={s.body}>{c.consequence}</Text>
          <Field label={c.current} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!state.busy} />
          {action === 'password' && <><Field label={c.next} value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!state.busy} /><Text style={s.muted}>{c.hint}</Text><Field label={c.repeat} value={repeat} onChangeText={setRepeat} secureTextEntry autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={128} editable={!state.busy} /><Notice>{repeat && next !== repeat ? c.mismatch : ''}</Notice></>}
          <CheckBox label={c.acknowledge} value={ack} onChange={setAck} disabled={state.busy} />
          <Button title={state.busy ? c.busy : action === 'password' ? c.save : c.confirmSignout} disabled={state.busy || !valid} onPress={() => {
            const input = { currentPassword: current, ...(action === 'password' ? { newPassword: next } : {}), acknowledged: true as const }; reset(); void submit(action, input);
          }} /><Button quiet title={c.cancel} disabled={state.busy} onPress={() => { reset(); setAction(null); }} />
        </View>}
      </>}
      <Button quiet title={locale === 'zh-CN' ? '回到家庭空间' : 'Back to family space'} disabled={state.busy} onPress={onBack} />
    </>}
  </Page>;
}
