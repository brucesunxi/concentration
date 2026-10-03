import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type { FamilyBillingStatus } from '../../../packages/contracts/family-billing.ts';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { familyBillingCopy } from '../../../packages/session-runtime/family-billing-copy.ts';
import { familyBillingRefreshDelay } from '../../../packages/session-runtime/family-billing-refresh.ts';
import { MobileClient, MobileRequestError } from './client';
import { Button, Notice, Page, s } from './ui';

export function FamilyBilling({ familyId, locale, client, onBack, onLogin }: { familyId: string; locale: Locale; client: MobileClient; onBack(): void; onLogin(): void }) {
  const [status, setStatus] = useState<FamilyBillingStatus | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(false);
  const active = useRef(true), sequence = useRef(0), login = useRef(onLogin); login.current = onLogin;
  async function reload() {
    const version = ++sequence.current;
    setBusy(true); setError(false);
    try {
      const next = await client.request<FamilyBillingStatus>('/family/billing');
      if (!active.current || version !== sequence.current || AppState.currentState !== 'active') return;
      if (next.familyId !== familyId || next.version !== 'family-billing-1') throw new Error('BILLING_SCOPE_MISMATCH');
      setStatus(next);
    } catch (cause) {
      if (!active.current || version !== sequence.current || AppState.currentState !== 'active') return;
      setStatus(null); setError(true);
      if (cause instanceof MobileRequestError && (cause.status === 401 || cause.code === 'PARENT_REQUIRED' || cause.code === 'OWNER_REQUIRED')) login.current();
    } finally { if (active.current && version === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true; void reload();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void reload(); });
    return () => { active.current = false; sequence.current++; listener.remove(); };
  }, [familyId, client]);
  useEffect(() => {
    if (busy) return;
    const timer = setTimeout(() => { if (AppState.currentState === 'active') void reload(); }, familyBillingRefreshDelay(status));
    return () => clearTimeout(timer);
  }, [busy, status, familyId, client]);
  const copy = familyBillingCopy(locale, status ?? undefined);
  return <Page title={copy.title}>
    <View style={s.card}>
      <Text accessibilityRole="header" style={s.heading}>{busy ? locale === 'en' ? 'Checking family access…' : '正在确认家庭使用状态…' : copy.heading}</Text>
      {!busy && <><Text style={s.body}>{copy.detail}</Text>{copy.until && <Text style={s.body}>{copy.until}</Text>}{copy.renewal && <Text style={s.muted}>{copy.renewal}</Text>}<Text style={s.muted}>{copy.rights}</Text></>}
      {error && <Notice>{locale === 'en' ? 'Access could not be confirmed. Saved records remain available.' : '暂时无法确认使用状态；已有记录仍可查看。'}</Notice>}
      <Button quiet disabled={busy} title={locale === 'en' ? 'Refresh status' : '刷新状态'} onPress={() => void reload()} />
    </View>
    <Button quiet title={locale === 'en' ? 'Back to family space' : '返回家庭空间'} onPress={onBack} />
  </Page>;
}
