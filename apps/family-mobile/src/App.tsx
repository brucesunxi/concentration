import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getLocales } from 'expo-localization';
import { MobileClient, MobileRequestError, unavailable } from './client';
import { Page, Button, Choice, Field, CheckBox, Notice, MobileBoundary, s, colors } from './ui';
import { Practice } from './Practice';
import { FamilyMembers } from './FamilyMembers';
import { JoinFamily } from './JoinFamily';
import { ParentSpace } from './ParentSpace';
import { FamilyArtwork } from './FamilyArtwork';
import { Recovery } from './Recovery';
import type { GoalInput } from '../../../packages/family-support/model.ts';
import { ParentGuide } from './ParentGuide';
import { AccountSecurity } from './AccountSecurity';
import { FamilyBilling } from './FamilyBilling';
import { PracticeLimits } from './PracticeLimits';
import { LifeGoals } from './LifeGoals';
import { TeenStrategyHistory } from './TeenStrategyHistory';
import { isNetworkFailure, verifyOfflineSession } from '../../../packages/session-runtime/offline-session.ts';
import { nativeVerifier } from '../../../packages/content/native-verifier.ts';
import { reconcileFamilyJournals, readOfflineSession, invalidateOffline } from './storage';
import { cleanupExportFiles } from './exports';
import { LocalJournalWarning } from './LocalJournalWarning';
import type { Me, Child, Session } from '../../../packages/contracts/models.ts';
import { collectionStatusAllowsPractice, collectionStatusCopy } from '../../../packages/contracts/collection-status.ts';
import { practiceInvitationCopy, practiceInvitationDay } from '../../../packages/contracts/practice-invitation.ts';
import type { PracticeLimits as PracticeLimitsSnapshot } from '../../../packages/contracts/practice-limits.ts';
import { childDataVisibilityCopy } from '../../../packages/contracts/child-data-visibility.ts';
import { supportedDeviceLocale } from '../../../packages/contracts/device-locale.ts';
import { connectionErrorCopy, requestErrorCopy } from '../../../packages/contracts/request-error-copy.ts';
import type { AgeBand, Locale, TaskId } from '../../../packages/task-engine/index.ts';
import { TASKS } from '../../../packages/task-engine/index.ts';
import { taskContent, translate, isTeen } from '../../../packages/content/copy.ts';

const client = new MobileClient();
function FamilyApp() {
  const [me, setMe] = useState<Me | null>(null), [session, setSession] = useState<Session | null>(null);
  const [offlineOffer,setOfflineOffer]=useState<NonNullable<Awaited<ReturnType<typeof readOfflineSession>>>|null>(null);
  const [locale, setLocale] = useState<Locale>(() => supportedDeviceLocale(getLocales().map(item => item.languageTag))), [familyName, setFamilyName] = useState('');
  const localeRef = useRef(locale); localeRef.current = locale;
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [storageUnavailable, setStorageUnavailable] = useState(false), [view, setView] = useState<'home' | 'add' | 'report' | 'life' | 'recovery' | 'guide' | 'security' | 'billing' | 'limits' | 'members' | 'join' | 'child-data-visibility' | 'strategy'>('home');
  const [lifeSuggestion, setLifeSuggestion] = useState<GoalInput['templateId'] | undefined>();
  const [selected, setSelected] = useState<Child | null>(null), [covered, setCovered] = useState(false);
  const [practiceInvitation, setPracticeInvitation] = useState<{childId:string;task:TaskId;identity:number;day:ReturnType<typeof practiceInvitationDay>}|null>(null);
  const mounted = useRef(true), identityVersion = useRef(0);
  const owner = me?.role === 'parent' && me.member?.role === 'owner', support = me?.role === 'parent' && me.member?.role === 'support';
  const t = translate(locale);
  const timedScreenReaderMessage = t('读屏模式下，限时看图题目前不适合可靠计分。可以选无单题倒计时的找一找或记一记；今天不练也可以。', 'Timed visual tasks cannot be scored reliably with a screen reader yet. You can choose untimed Search or Memory, or stop for today.');
  const message = (e: unknown) => e instanceof MobileRequestError
    ? requestErrorCopy(e.code, e.status, locale)
    : isNetworkFailure(e)
      ? connectionErrorCopy(locale)
      : t('暂时无法完成，请重试。', 'Unable to complete. Please retry.');
  const refresh = useCallback(async (resume = true) => {
    const version = ++identityVersion.current;
    setBusy(true); setError('');setOfflineOffer(null);setPracticeInvitation(null);
    try {
      const next = await client.request<Me>('/me');
      if (next.role === 'parent') await reconcileFamilyJournals(next.family.id, next.children);
      const active = next.role === 'child' ? await client.request<Session | null>('/sessions/active') : null;
      if (!mounted.current || version !== identityVersion.current) return;
      setMe(next); setFamilyName(next.family.name); setLocale(next.family.locale); setSession(resume ? active : null);
    } catch (e) {
      if (!mounted.current || version !== identityVersion.current) return;
      setMe(null); setSession(null);
      if(isNetworkFailure(e) && client.canRestoreOffline()){
        try{
          const saved=await readOfflineSession();
          if(saved){
            await verifyOfflineSession(saved,await client.deviceId(),Platform.OS as 'ios'|'android',saved.events,nativeVerifier);
            if(!mounted.current||version!==identityVersion.current)return;
            setOfflineOffer(saved);setLocale(saved.capsule.session.plan.locale);return;
          }
        }catch{
          if(mounted.current&&version===identityVersion.current)setError(t('本机练习已过期、资料不完整或设备时间发生变化。请联网确认后恢复，未到期的本机记录会保留。','The saved practice has expired, is incomplete, or the device clock changed. Reconnect to recover; unexpired local records are preserved.'));
          return;
        }
      } else if(!isNetworkFailure(e)) {
        let cleanupFailed=false;
        if(unavailable(e))await client.forgetChildAccess().catch(()=>{cleanupFailed=true;});
        await invalidateOffline().catch(()=>{cleanupFailed=true;});
        if(cleanupFailed){
          if(mounted.current&&version===identityVersion.current)setError(t('本机访问状态尚未清理完成，已停下恢复。请保持联网后重试。','Local access cleanup is pending. Recovery has stopped; stay connected and retry.'));
          return;
        }
      }
      if(!mounted.current||version!==identityVersion.current)return;
      if (!(e instanceof MobileRequestError && e.status === 401)) setError(t('还没有连接上家庭空间。未到期的本机记录会保留。', 'Could not connect to your family space. Unexpired local records are preserved.'));
    } finally { if (mounted.current && version === identityVersion.current) setBusy(false); }
  }, [locale]);
  async function restoreEntry() {
    const version = ++identityVersion.current;
    setBusy(true); setError('');
    try { cleanupExportFiles(); }
    catch {
      if (mounted.current && version === identityVersion.current) { setStorageUnavailable(true); setError(t('本机临时文件尚未清理，请重试。', 'Temporary local files could not be cleared. Please retry.')); setBusy(false); }
      return;
    }
    try {
      await client.restore();
      if (!mounted.current || version !== identityVersion.current) return;
      setStorageUnavailable(false);
      await refresh();
    } catch {
      if (mounted.current && version === identityVersion.current) { setStorageUnavailable(true); setError(t('无法读取本机安全存储。请解锁设备后重试。', 'Secure storage could not be read. Unlock the device and retry.')); setBusy(false); }
    }
  }
  useEffect(() => { mounted.current = true; void restoreEntry(); return () => { mounted.current = false; identityVersion.current++; }; }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setCovered(state !== 'active');
      if (state === 'active') { try { cleanupExportFiles(); } catch { setError(translate(localeRef.current)('导出临时文件清理尚未完成，请重新打开后重试。', 'Temporary export cleanup is pending. Reopen the app to retry.')); } }
      if (state !== 'active') {
        identityVersion.current++; client.lockParent();
        setMe(current => current?.role === 'parent' ? null : current); setSelected(null); setPracticeInvitation(null); setView('home'); setBusy(false);
      }
    });
    return () => subscription.remove();
  }, []);
  useEffect(()=>{
    if(me?.role!=='parent')return;let live=true,checking=false;
    const timer=setInterval(()=>{if(AppState.currentState!=='active'||checking)return;checking=true;void client.request<Me>('/me').then(next=>{if(!live)return;if(next.role!=='parent'||next.member?.id!==me.member?.id){client.lockParent();setMe(null);setSelected(null);setView('home');return;}if(next.member?.state!==me.member?.state)void refresh(false);}).catch(e=>{if(live&&e instanceof MobileRequestError&&e.status===401){identityVersion.current++;client.lockParent();setMe(null);setSelected(null);setView('home');}}).finally(()=>{checking=false;});},30000);
    return()=>{live=false;clearInterval(timer);};
  },[me?.role,me?.member?.id,me?.member?.state]);
  async function action(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { if (mounted.current) setError(message(e)); } finally { if (mounted.current) setBusy(false); } }
  async function start(child: Child, task: TaskId) {
    if (!collectionStatusAllowsPractice(child.collectionStatus,child.consentActive)) { setError(collectionStatusCopy(child.collectionStatus,locale).detail); return; }
    const identity = identityVersion.current;
    const screenReader = await AccessibilityInfo.isScreenReaderEnabled().catch(() => null);
    if (!mounted.current || identity !== identityVersion.current) return;
    if (screenReader === null) { setError(t('暂时无法确认读屏设置，请重新打开后再试。', 'Unable to check the screen reader setting. Reopen the app and try again.')); return; }
    if (screenReader && ['stop', 'sustain'].includes(task)) { setError(timedScreenReaderMessage); return; }
    const version = ++identityVersion.current;
    await action(async () => {
      const active = await client.start(child.id, task, screenReader ? 'assistive' : 'touch');
      if (!mounted.current || version !== identityVersion.current) return;
      setSession(active); setSelected(null); setView('home');
      setMe(current => current && ({ ...current, role: 'child', children: [child] }));
    });
  }
  function inviteToPractice(child: Child, task: TaskId) {
    if (!collectionStatusAllowsPractice(child.collectionStatus,child.consentActive)) { setError(collectionStatusCopy(child.collectionStatus,locale).detail); return; }
    const childId=child.id, identity=identityVersion.current;
    void action(async()=>{
      const screenReader = await AccessibilityInfo.isScreenReaderEnabled().catch(() => null);
      if(!mounted.current||identity!==identityVersion.current)return;
      if(screenReader === null){setError(t('暂时无法确认读屏设置，请重新打开后再试。', 'Unable to check the screen reader setting. Reopen the app and try again.'));return;}
      if(screenReader && ['stop', 'sustain'].includes(task)){setError(timedScreenReaderMessage);return;}
      const limits=await client.request<PracticeLimitsSnapshot>(`/children/${childId}/practice-limits`);
      if(!mounted.current||identity!==identityVersion.current)return;
      if(limits.version!=='practice-limits-1'||limits.childId!==childId)throw new Error('PRACTICE_PLAN_MISMATCH');
      setPracticeInvitation({childId,task,identity,day:practiceInvitationDay(limits,child.locale)});
    });
  }
  if (session && (me || offlineOffer)) return <View style={{ flex: 1 }}><Practice key={session.id} session={session} familyId={me?.family.id ?? offlineOffer!.capsule.familyId} client={client} offline={!!offlineOffer} onExit={() => { setSession(null); void refresh(false); }} />{covered && <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.background }}><Page title="Focus Island"><Text style={s.muted}>{t('回来后再继续。', 'Continue when you return.')}</Text></Page></View>}</View>;
  if (covered) return <Page title="Focus Island"><Text style={s.muted}>{t('回来后再继续。', 'Continue when you return.')}</Text></Page>;
  if(offlineOffer && !me) return <Page title={t('继续已准备的练习','Continue your prepared practice')} subtitle={taskContent(offlineOffer.capsule.session.plan.task,locale,offlineOffer.capsule.session.plan.ageBand).title}>
    <Text style={s.body}>{t('现在连不上家庭服务。可以恢复这台设备已经准备好的一份练习，不会开始新的课程。','The family service is unavailable. You can restore the practice already prepared on this device; this does not start a new course session.')}</Text>
    <Text style={s.muted}>{t('可继续至：','Available until: ')}{new Date(offlineOffer.capsule.session.continuation_grant.body.recordUntil).toLocaleString(locale)}</Text>
    <Notice>{t('家长停止采集或换设备的通知，联网后才能收到。本机资料仍是未审核的开发内容。','A parent’s collection or device changes are received when you reconnect. These local preview materials remain unreviewed.')}</Notice>
    <Button disabled={busy} title={t('恢复这份练习','Restore this practice')} onPress={()=>setSession(offlineOffer.capsule.session)} />
    <Button quiet disabled={busy} title={t('重新连接家庭服务','Reconnect to the family service')} onPress={()=>void refresh()} />
    <Button quiet disabled={busy} title={t('退出离线入口','Leave offline access')} onPress={()=>void action(async()=>{const version=++identityVersion.current;try{await client.logout()}finally{if(mounted.current&&version===identityVersion.current){setOfflineOffer(null);setSession(null);setMe(null)}}})} />
  </Page>;
  if(!me && view==='join')return <JoinFamily locale={locale} client={client} onBack={()=>setView('home')} onJoined={next=>{setMe(next);setFamilyName(next.family.name);setView('home');}}/>;
  if (!me) return <Login onJoin={()=>setView('join')} locale={locale} setLocale={setLocale} name={familyName} busy={busy} error={error} storageUnavailable={storageUnavailable} onRetry={() => void restoreEntry()} onSubmit={(name, password, create, memberLogin) => void action(async () => { const version = ++identityVersion.current; const next = create ? await client.setup(name, password, locale) : await client.login(name, password, memberLogin); if (next.role === 'parent') await reconcileFamilyJournals(next.family.id, next.children); if (!mounted.current || version !== identityVersion.current) return; setMe(next); setFamilyName(next.family.name); setLocale(next.family.locale); })} />;
  if(practiceInvitation){
    const invitedChild=me.children.find(child=>child.id===practiceInvitation.childId);
    if(invitedChild){
      const invitationCopy=practiceInvitationCopy(invitedChild.ageBand,invitedChild.locale);
      return <Page title={invitationCopy.title} subtitle={taskContent(practiceInvitation.task,invitedChild.locale,invitedChild.ageBand).title}>
        <Text style={s.body}>{invitationCopy.body}</Text>
        {!!practiceInvitation.day.message&&<Notice>{practiceInvitation.day.message}</Notice>}
        {me.role==='parent'&&<Text style={s.muted}>{invitationCopy.parentHint}</Text>}
        <Notice>{error}</Notice>
        <Button title={invitationCopy.begin} disabled={busy||!practiceInvitation.day.mayStart} onPress={()=>{
          const chosen=practiceInvitation;
          setPracticeInvitation(null);
          if(chosen.identity!==identityVersion.current){setError(t('家庭状态已更新，请重新选择练习。','Your family space changed. Choose the practice again.'));return;}
          void start(invitedChild,chosen.task);
        }}/>
        <Button quiet title={invitationCopy.later} disabled={busy} onPress={()=>setPracticeInvitation(null)}/>
        {!practiceInvitation.day.mayStart&&<Button quiet title={invitedChild.locale==='zh-CN'?'查看今天的安排':'View today’s plan'} onPress={()=>{setPracticeInvitation(null);setSelected(invitedChild);setView('limits');}}/>}
      </Page>;
    }
  }
  if(me.role==='parent' && me.member?.state==='pending')return <Page title={t('等待家庭创建者确认','Waiting for the family creator')}><Text style={s.heading}>{me.family.name} · {me.member.displayName}</Text><Text style={s.body}>{me.member.loginName}</Text><Text style={s.body}>{t('请与创建者核对登录名。确认之前，这里不会显示孩子资料。','Check your username with the creator. Child records stay hidden until they confirm.')}</Text><Notice>{error}</Notice><Button title={t('重新读取','Reload')} disabled={busy} onPress={()=>void refresh(false)}/><Button quiet title={t('退出登录','Sign out')} onPress={()=>void action(async()=>{await client.logout();setMe(null);})}/></Page>;
  if(view==='members' && me.role==='parent' && me.member)return <FamilyMembers familyId={me.family.id} viewerId={me.member.id} children={me.children} locale={locale} client={client} onBack={()=>setView('home')} onLogin={()=>{identityVersion.current++;client.lockParent();setMe(null);setView('home');}}/>;
  if (view === 'security' && me.role === 'parent') return <AccountSecurity key={me.family.id} familyId={me.family.id} familyName={me.family.name} locale={locale} client={client} onBack={() => setView('home')} onSignIn={message => { identityVersion.current++; client.lockParent(); setMe(null); setSession(null); setSelected(null); setView('home'); setError(message); }} />;
  if (view === 'billing' && owner) return <FamilyBilling key={me.family.id} familyId={me.family.id} locale={locale} client={client} onBack={() => setView('home')} onLogin={() => { identityVersion.current++; client.lockParent(); setMe(null); setView('home'); }} />;
  if (view === 'add' && owner) return <AddChild mode={me.mode} locale={locale} busy={busy} error={error} onBack={() => setView('home')} onSave={(alias, ageBand, childLocale) => void action(async () => { const version = ++identityVersion.current; await client.request('/children', 'POST', { alias, ageBand, locale: childLocale, ...(me.mode==='local-development'?{localConfirmation:true}:{}) }); if (!mounted.current || version !== identityVersion.current) return; setView('home'); await refresh(); })} />;
  if (view === 'limits' && selected) return <PracticeLimits support={support} allowLife={!support} key={`${me.family.id}:${selected.id}:${me.role}`} childId={selected.id} parent={owner} locale={locale} client={client} onBack={() => { setView('home'); setSelected(null); }} onParent={() => { identityVersion.current++; client.lockParent(); setMe(null); setSelected(null); setView('home'); }} onLife={() => { setLifeSuggestion(undefined); setView('life'); }} onRecovery={() => setView('recovery')} />;
  if (view === 'guide' && selected && me.role === 'parent') return <ParentGuide canChooseGoal={!support} key={`${me.family.id}:${selected.id}`} childId={selected.id} locale={locale} client={client} onBack={() => { setSelected(null); setView('home'); }} onLogin={() => { identityVersion.current++; client.lockParent(); setMe(null); setSelected(null); setView('home'); }} onLife={templateId => { setLifeSuggestion(templateId); setView('life'); }} />;
  if (view === 'life' && !support && selected && !selected.collectionStatus) return <Page title={t('生活小目标','Everyday goals')}><Notice>{collectionStatusCopy(selected.collectionStatus,locale).detail}</Notice><Button quiet title={t('返回','Back')} onPress={() => { setView('home'); setSelected(null); }} /></Page>;
  if (view === 'life' && !support && selected) return <LifeGoals key={`${me.family.id}:${selected.id}:${me.role}`} childId={selected.id} role={me.role} locale={selected.locale} client={client} initialTemplate={lifeSuggestion} entering={busy} error={error} onBack={() => { setView('home'); setSelected(null); setError(''); }} onEnterChild={() => void action(async () => {
    const version = ++identityVersion.current;
    const child = await client.enterChild(selected.id);
    if (!mounted.current || version !== identityVersion.current) return;
    setMe(current => current && ({ ...current, role: 'child', children: [child] })); setSelected(child);
  })} />;
  if (view === 'recovery' && selected && me.role === 'parent') return <Recovery key={`${me.family.id}:${selected.id}`} childId={selected.id} locale={locale} client={client} onBack={() => { identityVersion.current++; setView('home'); setSelected(null); }} onRequireLogin={() => { identityVersion.current++; client.lockParent(); setMe(null); setView('home'); setSelected(null); }} onResume={async id => {
    const version = ++identityVersion.current, child = selected;
    const restored = await client.recover(child.id,id);
    if (!mounted.current || version !== identityVersion.current) return;
    setSession(restored); setSelected(null); setView('home'); setMe(current => current && ({...current,role:'child',children:[child]}));
  }} />;
  if (view === 'report' && selected && me.role === 'parent') return <ParentSpace canManage={owner} key={selected.id} child={selected} family={me.family} mode={me.mode} locale={locale} client={client} onBack={() => { setView('home'); setSelected(null); void refresh(false); }} onChanged={() => { setView('home'); setSelected(null); void refresh(false); }} onRequireLogin={() => { setMe(null); setSelected(null); setView('home'); }} />;
  if (view === 'strategy' && me.role === 'child' && me.children[0] && isTeen(me.children[0].ageBand)) return <TeenStrategyHistory key={`${me.family.id}:${me.children[0].id}`} child={me.children[0]} locale={me.children[0].locale} client={client} onBack={() => setView('home')} onAccessEnded={() => { identityVersion.current++; void client.forgetChildAccess().finally(() => { setMe(null); setSelected(null); setView('home'); }); }} />;
  if (view === 'child-data-visibility' && me.role === 'child' && me.children[0]) {
    const copy = childDataVisibilityCopy(me.children[0].ageBand, me.children[0].locale);
    return <Page title={copy.title}><Text style={s.body}>{copy.introduction}</Text>{(['practice', 'reflection', 'control'] as const).map(section => <View key={section} style={s.card}><Text accessibilityRole="header" style={s.heading}>{copy[`${section}Heading`]}</Text><Text style={s.body}>{copy[section]}</Text></View>)}<Notice>{copy.device}</Notice><Button title={copy.close} onPress={() => setView('home')} /></Page>;
  }
  return <Page title={me.role === 'parent' ? t('一起，慢慢来。', 'One small step, together.') : t('今天想练习什么？', 'What would you like to practice?')} subtitle={me.role === 'parent' ? t('选择一位家庭成员，开始一段短练习。', 'Choose a family member for a short practice.') : t('你可以求助，也可以随时停下来。', 'You can ask for help and stop at any time.')}>
    <Notice>{error}</Notice>
    {me.role === 'parent' ? <FamilyArtwork kind="bridge" /> : me.children[0] && !isTeen(me.children[0].ageBand) && <FamilyArtwork kind="island" />}
    {me.role === 'parent' && <Text style={s.muted}>{me.mode === 'local-development' ? t('本地开发预览 · 仅供成人使用虚构资料验收', 'Local development preview · Adults testing with fictional profiles only') : t('练习须先完成适用的监护核验', 'Practice requires guardian verification')}</Text>}
    {me.children.map(child => <View key={child.id} style={s.card}><Text accessibilityRole="header" style={s.heading}>{child.alias}</Text><Text style={s.muted}>{child.ageBand} · {child.locale === 'en' ? 'English' : '简体中文'} · {isTeen(child.ageBand) ? 'FOCUS STUDIO' : 'FOCUS ISLAND'}</Text><Text style={s.body}>{child.course.complete ? t('基础课程已完成，可以选择喜欢的练习。', 'Foundation course complete. Choose a practice you enjoy.') : t(`第 ${child.course.week} 周 · 已完成 ${child.course.weekDone}/3 次`, `Week ${child.course.week} · ${child.course.weekDone}/3 complete`)}</Text>
      {child.ageReview.state!=='current'&&<Notice>{me.role==='parent'?t('年龄档需要复核，新练习暂停。请到记录、观察与资料管理中处理。','Age band review is needed; new practice is paused. Open Records, observations & data to resolve it.'):t('家庭正在更新适合你的安排。完成的记录还在。','Your family is updating your plan. Your saved records are still here.')}</Notice>}
      {me.role === 'child' && <Button quiet title={childDataVisibilityCopy(child.ageBand, child.locale).title} accessibilityContext={child.alias} onPress={() => setView('child-data-visibility')} />}
      {me.role === 'child' && isTeen(child.ageBand) && <Button quiet title={child.locale === 'en' ? 'My strategy trail' : '我的策略足迹'} accessibilityContext={child.alias} onPress={() => setView('strategy')} />}
      {me.role==='parent'&&<LocalJournalWarning familyId={me.family.id} childId={child.id} locale={locale}/>}
      {child.ageReview.state==='current'&&collectionStatusAllowsPractice(child.collectionStatus,child.consentActive) ? <>{!child.course.complete && <Button title={t('开始今天的推荐练习', 'Start today’s suggested practice')} accessibilityContext={child.alias} disabled={busy} onPress={() => inviteToPractice(child, child.course.task)} />}{TASKS.map(task => <Button key={task} quiet title={taskContent(task, child.locale, child.ageBand).title} accessibilityContext={child.alias} disabled={busy} onPress={() => inviteToPractice(child, task)} />)}</> : child.ageReview.state==='current'&&<Notice>{collectionStatusCopy(child.collectionStatus,locale).detail}</Notice>}
      {!support && <Button quiet title={t('生活小目标', 'Everyday goals')} accessibilityContext={child.alias} disabled={busy || !child.collectionStatus} onPress={() => { setLifeSuggestion(undefined); setSelected(child); setView('life'); setError(''); }} />}
      <Button quiet title={t('练习与休息', 'Practice & rest')} accessibilityContext={child.alias} disabled={busy} onPress={() => { setSelected(child); setView('limits'); }} />
      {me.role === 'parent' && <Button quiet title={t('家长陪伴小课', 'Parent guide')} accessibilityContext={child.alias} disabled={busy} onPress={() => { setSelected(child); setView('guide'); }} />}
      {me.role === 'parent' && <Button quiet title={t('未结束练习与换设备', 'Unfinished practice & changing devices')} accessibilityContext={child.alias} disabled={busy} onPress={() => { setSelected(child); setView('recovery'); }} />}
      {me.role === 'parent' && <Button quiet title={t('记录、观察与资料管理', 'Records, observations & data')} accessibilityContext={child.alias} onPress={() => { setSelected(child); setView('report'); }} />}
    </View>)}
    {owner && me.children.length < 3 && <Button quiet title={t('添加测试档案', 'Add a test profile')} disabled={busy} onPress={() => setView('add')} />}
    {me.role === 'parent' && <Button quiet title={t('家长协作','Parents together')} disabled={busy} onPress={()=>setView('members')}/>}
    {me.role === 'parent' && <Button quiet title={t('账号与登录', 'Account & sign-ins')} disabled={busy} onPress={() => setView('security')} />}
    {owner && <Button quiet title={t('家庭使用状态', 'Family access')} disabled={busy} onPress={() => setView('billing')} />}
    {me.role === 'child' && <Button quiet title={t('进入家长空间', 'Open parent space')} onPress={() => { setMe(null); setSession(null); }} />}
    <Button quiet title={t('退出家庭空间', 'Sign out')} disabled={busy} onPress={() => void action(async () => { const version = ++identityVersion.current; try { await client.logout(); } finally { if (mounted.current && version === identityVersion.current) { setMe(null); setSession(null); } } })} />
    {busy && <ActivityIndicator color={colors.accent} />}
  </Page>;
}

function Login({ locale, setLocale, name: initial, busy, error, storageUnavailable, onSubmit, onRetry, onJoin }: { locale: Locale; setLocale(l: Locale): void; name: string; busy: boolean; error: string; storageUnavailable: boolean; onSubmit(name: string, password: string, create: boolean, memberLogin:string): void; onRetry(): void; onJoin():void }) {
  const [memberLogin,setMemberLogin]=useState('owner');
  const [name, setName] = useState(initial), [password, setPassword] = useState(''), [create, setCreate] = useState(false), [accepted, setAccepted] = useState(false); const t = translate(locale);
  if (storageUnavailable) return <Page title={t('本机资料暂时无法读取', 'Local records are temporarily unavailable')}><Notice>{error}</Notice><Text style={s.body}>{t('已保存的资料不会被清除。请解锁设备后重新检查。', 'Saved records are kept. Unlock the device, then check again.')}</Text><Button title={t('重新检查本机安全状态', 'Check secure storage again')} disabled={busy} onPress={onRetry} /></Page>;
  return <Page title={t('欢迎来到专注岛', 'Welcome to Focus Island')} subtitle={t('给家长和孩子的短练习与生活策略。', 'Short practices and everyday strategies for families.')}><FamilyArtwork kind="island" compact /><View style={s.row}><Choice label="简体中文" selected={locale === 'zh-CN'} onPress={() => setLocale('zh-CN')} /><Choice label="English" selected={locale === 'en'} onPress={() => setLocale('en')} /></View><Notice>{t('当前为成人开发验收版，请使用虚构家庭资料。', 'This is an adult development preview. Use fictional family details.')}</Notice><Notice>{error}</Notice><View style={s.card}><Text style={s.heading}>{create ? t('建立测试家庭', 'Create a test family') : t('家长登录', 'Parent sign-in')}</Text><Field label={t('家庭名称', 'Family name')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} maxLength={48} />{!create&&<><Field label={t('家长登录名','Parent username')} value={memberLogin} onChangeText={setMemberLogin} autoCapitalize="none" autoCorrect={false} maxLength={32}/><Text style={s.muted}>{t('创建者填写 owner；受邀家长填写自己的登录名。','Creators use owner; invited parents use their username.')}</Text></>}<Field label={t('家长密码', 'Parent password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} />{create && <Text style={s.muted}>{t('新密码至少 15 个字符，可以使用容易记住的长句。', 'Use at least 15 characters. A memorable passphrase works.')}</Text>}{create && <CheckBox value={accepted} onChange={setAccepted} label={t('我会使用虚构资料进行本地测试。', 'I will use fictional details for local testing.')} />}<Button title={busy ? t('正在连接…', 'Connecting…') : create ? t('建立家庭', 'Create family') : t('进入家庭空间', 'Open family space')} disabled={busy || !name.trim() || [...password].length < (create ? 15 : 1) || (create && !accepted)} onPress={() => { const value = password; setPassword(''); onSubmit(name.trim(), value, create, memberLogin.trim()); }} /><Button quiet disabled={busy} title={create ? t('已有家庭，去登录', 'Already have a family? Sign in') : t('建立新的测试家庭', 'Create a new test family')} onPress={() => { setCreate(!create); setPassword(''); }} /></View><Button quiet title={t('接受邀请','Accept invitation')} disabled={busy} onPress={onJoin}/><Button quiet title={t('恢复已保存的孩子会话', 'Restore saved child session')} disabled={busy} onPress={onRetry} /></Page>;
}
function AddChild({ mode, locale, busy, error, onBack, onSave }: { mode: Me['mode']; locale: Locale; busy: boolean; error: string; onBack(): void; onSave(alias: string, age: AgeBand, locale: Locale): void }) {
  const t = translate(locale), [alias, setAlias] = useState(''), [age, setAge] = useState<AgeBand>('6-8'), [language, setLanguage] = useState<Locale>(locale), [confirm, setConfirm] = useState(false);
  return <Page title={t('添加一位小小探索者', 'Add an explorer')}><Notice>{error}</Notice><Field label={mode==='local-development'?t('测试昵称', 'Test nickname'):t('昵称','Nickname')} value={alias} onChangeText={setAlias} maxLength={24} /><Text style={s.label}>{t('年龄段', 'Age group')}</Text><View style={s.row}>{(['6-8', '9-11', '12-14', '15-17'] as AgeBand[]).map(value => <Choice key={value} label={value} selected={age === value} onPress={() => setAge(value)} />)}</View><View style={s.row}><Choice label="简体中文" selected={language === 'zh-CN'} onPress={() => setLanguage('zh-CN')} /><Choice label="English" selected={language === 'en'} onPress={() => setLanguage('en')} /></View>{mode==='local-development'?<CheckBox label={t('这是用于成人开发验收的虚构档案。', 'This is a fictional profile for adult development testing.')} value={confirm} onChange={setConfirm}/>:<Notice>{t('保存档案后仍需完成监护核验，才能开始练习。当前版本尚未开放核验入口。','Guardian verification is required after saving the profile, before practice. Verification is not yet available in this version.')}</Notice>}<Button title={t('保存档案', 'Save profile')} disabled={busy || !alias.trim() || (mode==='local-development'&&!confirm)} onPress={() => onSave(alias.trim(), age, language)} /><Button quiet title={t('返回', 'Back')} onPress={onBack} /></Page>;
}
export default function App() { return <SafeAreaProvider><StatusBar style="dark" /><MobileBoundary><FamilyApp /></MobileBoundary></SafeAreaProvider>; }
