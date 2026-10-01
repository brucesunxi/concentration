import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { WeeklyReport } from '../../../packages/reports/weekly.ts';
import { weeklyPresentation } from '../../../packages/reports/presentation.ts';
import { translate } from '../../../packages/content/copy.ts';
import { MobileClient, MobileRequestError } from './client';
import { Button, Notice, colors, s } from './ui';

export function WeeklyReview({ childId, locale, revision, client, onRequireLogin }: { childId: string; locale: Locale; revision: number; client: MobileClient; onRequireLogin(): void }) {
  const t = translate(locale), login = useRef(onRequireLogin); login.current = onRequireLogin;
  const [week, setWeek] = useState<string | undefined>(), [retry, setRetry] = useState(0), [expanded, setExpanded] = useState<string[]>([]);
  const [report, setReport] = useState<WeeklyReport | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false; const current = () => !cancelled && AppState.currentState === 'active';
    setBusy(true); setError(false); setReport(null); setExpanded([]);
    void client.request<WeeklyReport>(`/children/${childId}/weekly${week ? `?weekStart=${encodeURIComponent(week)}` : ''}`)
      .then(value => { if (!current()) return; if (value.childId !== childId) throw new Error('REPORT_OWNER_MISMATCH'); setReport(value); })
      .catch(e => { if (current()) { setError(true); if (e instanceof MobileRequestError && ['PARENT_REQUIRED', 'UNAUTHENTICATED'].includes(e.code)) login.current(); } })
      .finally(() => { if (current()) setBusy(false); });
    return () => { cancelled = true; };
  }, [childId, week, retry, revision, client]);
  const view = report ? weeklyPresentation(report, locale) : null;
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.heading}>{t('一起回顾这一周', 'Look back on the week together')}</Text>
    <View style={s.row}>
      <Button quiet title={t('上一周', 'Previous week')} disabled={busy || !report?.range.previous} onPress={() => setWeek(report!.range.previous!)} />
      <Button quiet title={t('本周', 'This week')} disabled={busy} onPress={() => { setWeek(undefined); setRetry(value => value + 1); }} />
      <Button quiet title={t('下一周', 'Next week')} disabled={busy || !report?.range.next} onPress={() => setWeek(report!.range.next!)} />
    </View>
    {busy && <ActivityIndicator color={colors.accent} accessibilityLabel={t('正在整理已确认记录', 'Preparing confirmed records')} />}
    {error && <><Notice>{t('暂时无法读取周回顾，请稍后重试。', 'This weekly review is unavailable. Please retry.')}</Notice><Button quiet title={t('重试', 'Retry')} onPress={() => setRetry(value => value + 1)} /></>}
    {view && <>
      <Text style={s.body}>{view.range}</Text><Text style={s.muted}>{view.subtitle}</Text>
      <View style={s.row}>{view.days.map(day => <View key={day.date} style={[s.field, { backgroundColor: colors.soft, borderRadius: 12, padding: 12 }]}><Text style={s.label}>{day.date}</Text><Text style={s.muted}>{day.label}</Text></View>)}</View>
      <Text style={s.body}>{view.coverage}</Text><Text style={s.muted}>{view.missing}</Text>
      {view.sections.map(section => <View key={section.key} style={s.field}><Text accessibilityRole="header" style={s.heading}>{section.title}</Text><Text style={s.muted}>{section.intro}</Text>
        {section.items.length ? section.items.map(item => <View key={item.key} style={[s.field, { borderTopWidth: 1, borderColor: colors.line, paddingVertical: 16 }]}><Text style={s.label}>{item.title}</Text>{item.lines.map((line, index) => <Text key={index} style={s.muted}>{line}</Text>)}{item.details && <><Button quiet title={expanded.includes(item.key) ? t('收起比较条件', 'Hide comparison conditions') : t('查看比较条件', 'View comparison conditions')} onPress={() => setExpanded(values => values.includes(item.key) ? values.filter(key => key !== item.key) : [...values, item.key])} />{expanded.includes(item.key) && item.details.map(line => <Text key={line} style={s.muted}>{line}</Text>)}</>}</View>) : <Text style={s.muted}>{section.empty}</Text>}
      </View>)}
    </>}
  </View>;
}
