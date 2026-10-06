import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { Child, Me } from '../../../packages/contracts/models.ts';
import type { Locale, TaskId } from '../../../packages/task-engine/index.ts';
import { TASKS } from '../../../packages/task-engine/index.ts';
import { taskContent, translate } from '../../../packages/content/copy.ts';
import { performProfileAction, requireCurrent } from '../../../packages/session-runtime/profile-actions.ts';
import type { ProfileAction } from '../../../packages/session-runtime/profile-actions.ts';
import { MobileClient, MobileRequestError } from './client';
import { Button, CheckBox, Choice, Field, Notice, Page, colors, s } from './ui';
import { readChildJournals, removeChildJournals, reconcileFamilyJournals } from './storage';
import { shareChildExport } from './exports';
import { WeeklyReview } from './WeeklyReview';
import { HistoryClient, initialHistoryState } from '../../../packages/session-runtime/history-client.ts';
import { historyCopy } from '../../../packages/session-runtime/history-copy.ts';
import type { HistoryKind } from '../../../packages/contracts/history.ts';
import { collectionStatusAllowsPractice, collectionStatusCopy } from '../../../packages/contracts/collection-status.ts';
import { AgeReview } from './AgeReview';

interface Props { canManage?: boolean; child: Child; family: Me['family']; mode: Me['mode']; locale: Locale; client: MobileClient; onBack(): void; onChanged(): void; onRequireLogin(): void }
export function ParentSpace({ child, family, mode, locale, client, onBack, onChanged, onRequireLogin, canManage = true }: Props) {
  const t = translate(locale), live = useRef(true), running = useRef(false);
  const [tab, setTab] = useState<'records' | 'observation' | 'privacy' | 'age'>('records');
  const [history,setHistory] = useState(initialHistoryState), historyClient=useRef<HistoryClient|null>(null);
  const report=history.data, copy=historyCopy(locale);
  const [actionBusy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const busy=actionBusy||history.busy;
  const [task, setTask] = useState<TaskId>('search'), [context, setContext] = useState('packing'), [prompts, setPrompts] = useState('0'), [childChoice, setChildChoice] = useState(true);
  const [intent, setIntent] = useState<ProfileAction | null>(null), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [acknowledged, setAcknowledged] = useState(false);
  const [pendingCleanup, setPendingCleanup] = useState(false), [closed, setClosed] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const current = () => live.current && AppState.currentState === 'active';
  const contexts: Record<string, string> = { packing: t('准备物品', 'Getting things ready'), tidying: t('整理小空间', 'Tidying a space'), reading: t('短段阅读', 'A little reading'), project: t('个人小项目', 'A small project') };
  const labels: Record<ProfileAction, string> = { export: t('导出这份档案', 'Export this profile'), withdraw: t('停止此档案的数据采集', 'Stop collection for this profile'), delete: t('删除此档案和记录', 'Delete this profile and records') };
  async function reload() {
    await historyClient.current?.refresh();
  }
  function explain(e: unknown) {
    const code = e instanceof MobileRequestError ? e.code : e instanceof Error ? e.message : '';
    if (['UNAUTHENTICATED', 'PARENT_REQUIRED'].includes(code)) { onRequireLogin(); return; }
    const text: Record<string, string> = {
      LOGIN_FAILED: t('密码不正确，请重新输入。', 'The password is incorrect. Please try again.'),
      CONSENT_REVOKED: t('此档案已经停止采集，无法添加新观察。', 'Collection has stopped for this profile. New observations are unavailable.'),
      REAUTH_REQUIRED: t('请重新验证家长身份。', 'Please verify your parent identity again.'),
      NOT_FOUND: t('档案已不可用，请返回家庭空间刷新。', 'This profile is unavailable. Return to your family space to refresh.'),
      EXPORT_PARTIAL_FILE: t('保存未完成，选定位置可能留有不完整文件，请检查。', 'Saving failed. Check the selected folder for an incomplete file.'),
      SHARING_UNAVAILABLE: t('此设备暂时无法打开系统分享，请稍后重试。', 'System sharing is unavailable. Please retry later.'),
      EXPORT_TOO_LARGE: t('记录超过本机导出大小限制，请使用网页端导出。', 'These records exceed the mobile export limit. Use the web app to export them.'),
      EXPORT_SERVER_LIMIT: t('记录超过当前单次导出上限，文件尚未生成。请保留原设备资料，待支持分批导出。', 'The records exceed the current server export limit. No file was created. Keep the original device data until split exports are available.'),
      PROFILE_UNAVAILABLE: t('档案已不可用，请返回家庭空间。', 'This profile is unavailable. Return to your family space.'),
      PARENT_SCOPE_INCOMPLETE: t('只有家庭创建者的完整档案列表才能确认删除结果。请用创建者账号重试。', 'Only the family creator’s complete profile list can confirm a deletion. Sign in as the creator and retry.'),
    };
    setError(text[code] ?? t('暂时无法完成。未确认的操作不会显示为成功，请检查连接后重试。', 'Unable to finish. Unconfirmed operations are not marked successful. Check your connection and retry.'));
  }
  async function run(fn: () => Promise<void>) {
    if (running.current || !current()) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { if (current()) explain(e); }
    finally { running.current = false; if (current()) setBusy(false); }
  }
  useEffect(() => {
    live.current = true;
    const history=new HistoryClient(child.id,path=>client.request(path),value=>{if(current()){setHistory(value);if(value.needsParent)onRequireLogin();}});historyClient.current=history;
    void history.refresh();
    return () => { live.current = false; history.dispose(); };
  }, [child.id]);
  function chooseIntent(value: ProfileAction) { setIntent(value); setPassword(''); setConfirmation(''); setAcknowledged(false); setError(''); setNotice(''); }
  async function saveObservation() {
    const input = { task, context, prompts: Number(prompts), childChoice };
    if (!/^\d{1,2}$/.test(prompts) || input.prompts > 20) { setError(t('提醒次数请输入 0 到 20 的整数。', 'Enter a whole number of reminders from 0 to 20.')); return; }
    await run(async () => {
      const body = JSON.stringify(input);
      if (attempt.current?.body !== body) attempt.current = { body, key: randomUUID() };
      await client.request(`/children/${child.id}/observations`, 'POST', input, { 'Idempotency-Key': attempt.current.key });
      attempt.current = null; if (!current()) return;
      setTab('records'); setNotice(t('这次生活观察已保存。', 'This everyday observation is saved.')); await reload();
    });
  }
  async function confirmIntent() {
    const action = intent, value = password; setPassword('');
    if (!action || !value || !acknowledged || (action === 'delete' && confirmation !== child.alias)) return;
    await run(async () => {
      const outcome = await performProfileAction(action, family.id, child.id, {
        authenticate: async () => { const me = await client.login(family.name, value); requireCurrent(current); if (me.role === 'parent' && me.family.id === family.id) await reconcileFamilyJournals(me.family.id, me.children, me.member?.role === 'owner' && me.member.state === 'active'); return me; }, identity: () => client.request<Me>('/me'), current,
        request: (path, method) => client.request(path, method, method === 'POST' ? {} : undefined),
        cleanup: () => removeChildJournals(family.id, child.id),
        share: async data => {
          const records = await readChildJournals(family.id, child.id); requireCurrent(current);
          const combined = { ...(data as Record<string, unknown>), localRecovery: { scope: 'this-device-only', capturedAt: new Date().toISOString(), records } };
          return shareChildExport(combined, child.id, current, labels.export);
        },
      });
      if (!current()) return;
      setIntent(null);
      if (action === 'export') {
        setNotice(outcome.delivery === 'saved' ? t('文件已保存到你选择的位置。', 'The file was saved to your selected folder.') : outcome.delivery === 'cancelled' ? t('已取消保存，没有创建导出文件。', 'Saving was cancelled. No export file was created.') : t('分享窗口已关闭。是否保存成功，请在所选位置确认。', 'The share sheet has closed. Check your chosen destination to confirm the file was saved.'));
      } else {
        setClosed(true); setPendingCleanup(!outcome.localCleared);
        setNotice(outcome.localCleared ? t('家庭服务已处理，本机恢复日志已清理。已导出的外部副本由你管理。', 'The family service has processed your request and local recovery records are cleared. You manage any previously exported copies.') : t('家庭服务已处理，但本机恢复日志还未清理。请重试本机清理。', 'The family service has processed your request, but local recovery records are not yet cleared. Retry local cleanup.'));
      }
    });
  }
  function pager(kind:HistoryKind) { if(!report)return null;return <View style={s.card}>
    <Text accessibilityLiveRegion="polite" style={s.muted}>{history.busy&&history.target===kind?copy.loading:copy.page(history.pages[kind],report[kind].length)}</Text>
    <Notice>{history.error&&history.target===kind?copy.error(history.error):''}</Notice>
    <Button quiet title={copy.newer(kind)} disabled={busy||history.pages[kind]===1} onPress={()=>void historyClient.current?.move(kind,'newer')}/>
    <Button quiet title={copy.older(kind)} disabled={busy||!report.history[kind].nextCursor} onPress={()=>void historyClient.current?.move(kind,'older')}/>
    {!report.history[kind].nextCursor&&report[kind].length>0&&<Text style={s.muted}>{copy.end}</Text>}
  </View>; }
  return <Page title={`${child.alias} · ${t('家长空间', 'Parent space')}`} subtitle={t('关注具体尝试，也留意生活中的变化。', 'Notice specific attempts and everyday changes.')}>
    {!closed && <View style={s.row}>
      {([['records', t('练习与生活记录', 'Records')], ['observation', t('记一次观察', 'Add an observation')], ['privacy', t('资料与权限', 'Data & access')], ['age', t('年龄档复核', 'Age review')]] as const).filter(([value])=>canManage||!['privacy','age'].includes(value)).map(([value, label]) => <Button key={value} quiet={tab !== value} disabled={busy} title={label} onPress={() => { setTab(value); setError(''); setNotice(''); setIntent(null); setPassword(''); }} />)}
    </View>}
    <Notice>{error}</Notice><Notice>{notice}</Notice>
    {busy && <ActivityIndicator color={colors.accent} accessibilityLabel={t('正在处理', 'Working')} />}
    {!closed&&tab==='age'&&<AgeReview child={child} locale={locale} mode={mode} client={client} onChanged={onChanged} onRequireLogin={onRequireLogin}/>}
    {!closed && tab === 'records' && <>
      <WeeklyReview key={child.id} childId={child.id} locale={locale} revision={report?.observationCount ?? 0} client={client} onRequireLogin={onRequireLogin} />
      <Text style={s.muted}>{copy.explanation}</Text>
      <Button quiet title={copy.refresh} disabled={busy} onPress={()=>void reload()}/>
      <Notice>{history.error&&!history.target?copy.error(history.error):''}</Notice>
      {report?.sessions.length === 0 && <Text style={s.body}>{t('还没有完成的练习记录。', 'No saved practice results yet.')}</Text>}
      {report?.sessions.map(({ id, result, created_at }) => <View key={id} style={s.card}>
        <Text style={s.heading}>{taskContent(result.task, locale, child.ageBand).title}</Text>
        <Text style={s.muted}>{new Date(created_at).toLocaleString(locale)}</Text>
        <Text style={s.body}>{result.environment?.input === 'assistive' ? t(`读屏方式完成正式步骤 ${result.metrics.trials + result.metrics.assisted} 个，单独保留，不做正确率或能力判断。`, `${result.metrics.trials + result.metrics.assisted} formal screen reader steps, kept separately without an accuracy or ability rating.`) : result.metrics.trials ? t(`独立正确 ${result.metrics.correct} / ${result.metrics.trials} 个步骤`, `${result.metrics.correct} / ${result.metrics.trials} independent steps correct`) : t('尚无独立有效步骤', 'No valid independent steps yet')}</Text>
        <Text style={s.muted}>{t(`帮助 ${result.metrics.assisted} 次 · 中断 ${result.interruptions} 次`, `${result.metrics.assisted} assisted · ${result.interruptions} interrupted`)}</Text>
        <Text style={s.muted}>{result.historyOnly ? t('换设备前的独立记录 · 不计入课程', 'Previous-device record · Not counted in the course') : result.completed ? t('完整完成', 'Completed') : result.metrics.trials + result.metrics.assisted === 0 ? t('提前结束 · 尚无正式步骤', 'Stopped early · No formal step completed') : t('提前结束', 'Stopped early')}</Text>
      </View>)}
      {pager('sessions')}
      <Text accessibilityRole="header" style={s.heading}>{report ? t(`生活观察 · 共 ${report.observationCount} 条`, `Everyday observations · ${report.observationCount} total`) : t('生活观察', 'Everyday observations')}</Text>
      {report?.observations.map(observation => <View key={observation.id} style={s.card}>
        <Text style={s.heading}>{contexts[observation.context]}</Text>
        <Text style={s.body}>{t(`提醒 ${observation.prompts} 次`, `${observation.prompts} reminders`)} · {observation.child_choice ? t('孩子自己选择', 'Chosen by the child') : t('一起商量选择', 'Chosen together')}</Text>
        <Text style={s.muted}>{new Date(observation.created_at).toLocaleDateString(locale)}</Text>
      </View>)}
      {pager('observations')}
    </>}
    {!closed && tab === 'observation' && <View style={s.card}>
      <Text style={s.heading}>{t('记录一次具体尝试', 'Record one specific attempt')}</Text>
      <Text style={s.muted}>{t('记下做了什么、需要几次提醒。一次观察不能说明能力提高或下降。', 'Note the activity and reminders needed. One observation does not show an increase or decrease in ability.')}</Text>
      <Text style={s.label}>{t('与哪个练习有关？', 'Which practice does it relate to?')}</Text>
      <View style={s.row}>{TASKS.map(value => <Choice key={value} label={taskContent(value, locale, child.ageBand).title} selected={task === value} onPress={() => { if (!busy) setTask(value); }} />)}</View>
      <Text style={s.label}>{t('做了什么？', 'What was the activity?')}</Text>
      <View style={s.row}>{Object.entries(contexts).map(([value, label]) => <Choice key={value} label={label} selected={context === value} onPress={() => { if (!busy) setContext(value); }} />)}</View>
      <Field label={t('提醒次数（0–20）', 'Number of reminders (0–20)')} value={prompts} onChangeText={setPrompts} keyboardType="number-pad" maxLength={2} editable={!busy} />
      <CheckBox label={t('这件事是孩子自己选择的', 'The child chose this activity')} value={childChoice} onChange={value => { if (!busy) setChildChoice(value); }} />
      <Button title={t('保存这次观察', 'Save this observation')} disabled={busy || !collectionStatusAllowsPractice(child.collectionStatus,child.consentActive)} onPress={() => void saveObservation()} />
    </View>}
    {!closed && canManage && tab === 'privacy' && <View style={s.card}>
      <Text style={s.heading}>{t('你可以管理这份资料', 'You control this profile')}</Text>
      <Text style={s.muted}>{t('敏感操作需要再次输入家长密码。', 'Enter your parent password again for sensitive actions.')}</Text>
      <Notice>{collectionStatusCopy(child.collectionStatus,locale).detail}</Notice>
      {!intent ? (['export', 'withdraw', 'delete'] as ProfileAction[]).map(value => <Button key={value} title={labels[value]} quiet={value !== 'delete'} danger={value === 'delete'} disabled={busy} onPress={() => chooseIntent(value)} />) : <>
        <Text style={s.heading}>{labels[intent]}</Text>
        <Text style={s.body}>{intent === 'export' ? t('文件包含这份档案在家庭服务中的记录，以及此设备保存的恢复日志。其他离线设备的日志不包含在内。由你选择保存位置或分享对象。', 'The file includes this profile’s server records and recovery logs on this device. Logs on other offline devices are not included. You choose where to save or share it.') : intent === 'withdraw' ? t('停止后，此档案不能开始新练习、添加观察或补传旧会话。已有服务端记录保留供导出，本机恢复日志会清理。', 'This stops new practice, observations and uploads from old sessions. Existing server records remain available for export; local recovery logs are cleared.') : t('删除家庭服务中的这份档案、关联练习与观察，并清理本机恢复日志。此操作无法撤销，已导出的外部副本由你管理。', 'Delete this profile and its practices and observations from the family service, and clear local recovery logs. This cannot be undone. You manage previously exported copies.')}</Text>
        {intent === 'delete' && <Field label={t(`输入昵称「${child.alias}」确认`, `Enter “${child.alias}” to confirm`)} value={confirmation} onChangeText={setConfirmation} autoCorrect={false} editable={!busy} />}
        <CheckBox label={t('我已了解上述范围', 'I understand the scope above')} value={acknowledged} onChange={value => { if (!busy) setAcknowledged(value); }} />
        <Field label={t('家长密码', 'Parent password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} />
        <Button title={labels[intent]} danger={intent === 'delete'} disabled={busy || !password || !acknowledged || (intent === 'delete' && confirmation !== child.alias)} onPress={() => void confirmIntent()} />
        <Button quiet title={t('取消', 'Cancel')} disabled={busy} onPress={() => { setIntent(null); setPassword(''); }} />
      </>}
    </View>}
    {pendingCleanup && <Button title={t('重试本机清理', 'Retry local cleanup')} disabled={busy} onPress={() => void run(async () => { await removeChildJournals(family.id, child.id); if (current()) { setPendingCleanup(false); setNotice(t('本机恢复日志已清理。', 'Local recovery records are cleared.')); } })} />}
    <Button quiet title={t('回到家庭空间', 'Back to family space')} disabled={busy} onPress={closed ? onChanged : onBack} />
  </Page>;
}
