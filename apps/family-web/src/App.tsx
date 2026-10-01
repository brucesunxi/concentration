import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode, MouseEvent } from 'react';
import { ArrowRight, ArrowUpRight, Leaf, Compass, BarChart3, Users, Plus, Check, LockKeyhole, Clock3, ChevronDown, X, Globe2, BookOpen, Download, LogOut, ShieldCheck, Target, PauseCircle, Layers3, Sparkles, MoreHorizontal } from 'lucide-react';
import { TASKS } from '../../../packages/task-engine/index.ts';
import type { TaskId, Locale, AgeBand } from '../../../packages/task-engine/index.ts';
import { request, RequestError, deviceId, environmentFor, inputForClick, accessSender, prepareBrowserIdentity } from './api.ts';
import type { Me, Child, Session, AccountAccessEvent, AccountAccessOutcome, DeletedFamily } from './api.ts';
import type { GoalInput } from '../../../packages/family-support/model.ts';
import { translate, taskContent, isTeen } from './content.ts';
import { Play } from './Play.tsx';
import { clearChildJournals, journal } from './journal.ts';
import { LocalJournalWarning } from './LocalJournalWarning.tsx';
import { isNetworkFailure, verifyOfflineSession } from '../../../packages/session-runtime/offline-session.ts';
import { Stimulus } from './Stimulus.tsx';
import hero from '../../../packages/visuals/runtime/hero-island.webp';
import bridge from '../../../packages/visuals/runtime/bridge-scene.webp';
import { securityCopy } from '../../../packages/session-runtime/account-security-copy.ts';
import { isHostedPreview } from './preview-context.ts';
import { collectionStatusAllowsPractice, collectionStatusCopy } from '../../../packages/contracts/collection-status.ts';
import { practiceInvitationCopy } from '../../../packages/contracts/practice-invitation.ts';
import { childDataVisibilityCopy } from '../../../packages/contracts/child-data-visibility.ts';
import './practice-invitation.css';
import './child-data-visibility.css';

const taskIcons = { search: Target, stop: PauseCircle, memory: Layers3, sustain: Sparkles };
const RecordHistory = lazy(() => import('./RecordHistory.tsx'));
const TeenStrategyHistory = lazy(() => import('./TeenStrategyHistory.tsx'));
const Recovery = lazy(() => import('./Recovery.tsx'));
const LifeGoals = lazy(() => import('./LifeGoals.tsx'));
const ParentGuide = lazy(() => import('./ParentGuide.tsx'));
const AccountSecurity = lazy(() => import('./AccountSecurity.tsx'));
const FamilyMembers = lazy(() => import('./FamilyMembers.tsx'));
const JoinFamily = lazy(() => import('./JoinFamily.tsx'));
const PracticeLimits = lazy(() => import('./PracticeLimits.tsx'));
const AgeReview = lazy(() => import('./AgeReview.tsx'));
function preferredLocale():Locale {
  try{const saved=localStorage.getItem('focus-ui-locale');if(saved==='zh-CN'||saved==='en')return saved;}catch{}
  return navigator.language.toLowerCase().startsWith('zh')?'zh-CN':'en';
}
function Dialog({ title, children, onClose, locale, navigation = false }: { title: string; children: ReactNode; onClose: () => void; locale: Locale; navigation?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const d = ref.current!, opener = document.activeElement;
    d.showModal();
    const cancel = (e: Event) => { e.preventDefault(); close.current(); };
    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      const controls = [...d.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')].filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); d.focus(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === d)) { e.preventDefault(); last!.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === d)) { e.preventDefault(); first.focus(); }
    };
    d.addEventListener('cancel', cancel);
    d.addEventListener('keydown', trapTab);
    return () => {
      d.removeEventListener('cancel', cancel); d.removeEventListener('keydown', trapTab); d.close();
      if (document.activeElement === document.body) {
        const target = opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length ? opener : document.getElementById('page-title');
        target?.focus({ preventScroll: true });
      }
    };
  }, []);
  return <dialog ref={ref} tabIndex={-1} lang={locale} className={navigation ? 'navigation-dialog' : undefined} aria-labelledby={titleId}><div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label={locale === 'en' ? 'Close' : '关闭'} onClick={onClose}><X size={20} /></button></div>{children}</dialog>;
}

export function App() {
  const [locale, setLocale] = useState<Locale>(preferredLocale), [me, setMe] = useState<Me | null>(null), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(''), [page, setPage] = useState<'home' | 'life' | 'report' | 'strategy' | 'family' | 'method' | 'recovery' | 'guide' | 'limits'>('home');
  const [lifeSuggestion, setLifeSuggestion] = useState<{childId: string; templateId: GoalInput['templateId']} | null>(null);
  const [session, setSession] = useState<Session | null>(null), [reportRevision, setReportRevision] = useState(0);
  const [offlineOffer,setOfflineOffer]=useState<NonNullable<Awaited<ReturnType<ReturnType<typeof journal>['resume']>>>|null>(null);
  const [modal, setModal] = useState<'profile' | 'login' | 'observation' | 'privacy' | 'navigation' | 'practice-invitation' | 'child-data-visibility' | null>(null), [authMode, setAuthMode] = useState<'setup' | 'login' | 'join'>('setup');
  const [practiceInvitation, setPracticeInvitation] = useState<{childId: string; task: TaskId; identity: number} | null>(null);
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [notice, setNotice] = useState('');
  const [accountNotice, setAccountNotice] = useState<'password' | 'signout' | 'uncertain' | 'delete-uncertain' | 'signin' | 'deleted' | 'deleted-local-pending' | null>(null);
  const [unavailable,setUnavailable]=useState(false);
  const accessVersion = useRef(0);
  const refreshVersion=useRef(0), mounted=useRef(true);
  const parentDestination = useRef<typeof page>('home');
  const pageTitle = useRef<HTMLHeadingElement>(null), focusPage = useRef(false);
  const observationAttempt = useRef<{ body: string; key: string } | null>(null);
  const child = me?.children.find(c => c.id === selected) ?? me?.children[0];
  const invitedChild = practiceInvitation && me?.children.find(c => c.id === practiceInvitation.childId);
  const owner = me?.role === 'parent' && me.member?.role === 'owner', support = me?.role === 'parent' && me.member?.role === 'support';
  const t = translate(locale), teen = child ? isTeen(child.ageBand) : false, hostedPreview = isHostedPreview();
  function accountEnded(outcome: AccountAccessOutcome, deletingFamily?: DeletedFamily) {
    accessVersion.current++; refreshVersion.current++;
    setMe(null); setSession(null);  setOfflineOffer(null); setModal(null); setPracticeInvitation(null); setSelected(''); setPage('home'); setLoading(false); setUnavailable(false); setAuthMode('login'); setAccountNotice(outcome); setError('');
    void ((outcome === 'deleted' || outcome === 'deleted-local-pending') && deletingFamily
      ? journal().clearFamily(deletingFamily.id,deletingFamily.childIds) : journal().invalidate()).catch(() => undefined);
  }
  useEffect(() => {
    const changed = (event: Event) => {const detail=(event as CustomEvent<AccountAccessEvent>).detail;accountEnded(detail.outcome,detail.deletingFamily);};
    window.addEventListener('focus-account-access', changed); return () => window.removeEventListener('focus-account-access', changed);
  }, []);
  useEffect(() => { document.documentElement.lang = locale;try{localStorage.setItem('focus-ui-locale',locale);}catch{} }, [locale]);
  useEffect(() => { if (focusPage.current && !modal) { focusPage.current = false; pageTitle.current?.focus({ preventScroll: true }); } }, [page, modal]);

  async function refresh(resume = true) {
    const version=++refreshVersion.current,identity=accessVersion.current;
    const current=()=>mounted.current&&version===refreshVersion.current&&identity===accessVersion.current;
    setOfflineOffer(null);setUnavailable(false);setError('');
    try {
      const next = await request<Me>('/me');if(!current())return null;
      const active=next.role==='child'?await request<Session|null>('/sessions/active'):null;
      if(!current())return null;
      if(next.role==='parent'||!active)await journal().invalidate();
      if(!current())return null;setMe(next);
      if (next.role === 'child') {  setPage('home'); setLocale(next.children[0]?.locale ?? next.family.locale); }
      setSelected(prev => next.children.some(c => c.id === prev) ? prev : next.children[0]?.id ?? '');
      if (resume && next.role === 'child' && active) setSession(active);
      return next;
    } catch (e) {
      if(!current())return null;setMe(null);setSession(null);setModal(null);
      if(isNetworkFailure(e)){
        setUnavailable(true);
        try{
          const saved=await journal().resume();
          if(saved){await verifyOfflineSession(saved,deviceId(),'web',saved.events);if(current()){setOfflineOffer(saved);setLocale(saved.capsule.session.plan.locale);}return null;}
        }catch{if(current())setError(t('本机练习已过期、资料不完整或时间发生变化。请联网恢复，未到期的本机记录会保留。','The saved practice has expired, is incomplete, or the clock changed. Reconnect to recover; unexpired local records are preserved.'));return null;}
      }else{
        try{await journal().invalidate();}catch{if(current())setError(t('本机访问清理尚未完成，请联网后重试。','Local access cleanup is pending. Reconnect and retry.'));return null;}
      }
      if(e instanceof RequestError&&e.status===401)return null;
      if(current())setError(t('暂时连接不上家庭服务。未到期的本机记录会保留。','The family service is unavailable. Unexpired local records are preserved.'));return null;
    } finally { if(current())setLoading(false); }
  }
  useEffect(() => { mounted.current=true;void prepareBrowserIdentity().then(()=>refresh()).catch(e => { if(mounted.current){setError(e.message);setLoading(false);} });return()=>{mounted.current=false;refreshVersion.current++;accessVersion.current++;}; }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('focus-family-access');
    channel.onmessage = (event) => {
      if(event.data?.source===accessSender)return;
      if(event.data?.reason==='account-security'){accountEnded(event.data.outcome,event.data.deletingFamily);return;}
      accessVersion.current++;
      setMe(null); setSession(null); setOfflineOffer(null); setModal(null); setPracticeInvitation(null); setLoading(true);
      void refresh(false).catch(e => { setError(e.message); setLoading(false); });
    };
    return () => channel.close();
  }, []);
  useEffect(() => {
    if(me?.role !== 'parent')return;
    let live=true,checking=false;
    const check=async()=>{if(document.hidden||checking)return;checking=true;try{const next=await request<Me>('/me');if(!live)return;if(next.role!=='parent'||next.member?.id!==me.member?.id){accountEnded('signin');return;}if(next.member?.state!==me.member?.state)await refresh(false);}catch(e){if(live&&e instanceof RequestError&&e.status===401)accountEnded('signin');}finally{checking=false;}};
    const timer=window.setInterval(()=>void check(),30000);const focus=()=>void check();window.addEventListener('focus',focus);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',focus);};
  },[me?.role,me?.member?.id,me?.member?.state]);
  const safely = async (fn: () => Promise<void>) => { if (pending) return; setPending(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof RequestError && e.code === 'PRACTICE_PAUSED' ? t('家庭已暂停新练习。可以休息，也可以看看生活小目标。', 'Your family has paused new practice. Rest or explore everyday goals.') : e instanceof RequestError && e.code === 'DAILY_LIMIT' ? t('今天的练习安排已足够，可以先休息。', 'Today’s practice allowance is complete. Take a break.') : e instanceof Error ? e.message : t('暂时无法完成，请重试。', 'Unable to complete. Please retry.')); if (e instanceof RequestError && ['PARENT_REQUIRED', 'REAUTH_REQUIRED'].includes(e.code)) setModal('login'); } finally { setPending(false); } };
  function navigate(next: typeof page) { accessVersion.current++; setError(''); setLifeSuggestion(null); if (['report', 'family', 'recovery', 'guide'].includes(next) && me?.role === 'child') { parentDestination.current = next; setModal('login'); return; } focusPage.current = true; if (next === page && !modal) { focusPage.current = false; pageTitle.current?.focus({ preventScroll: true }); } setPage(next); window.scrollTo({ top: 0 }); }

  async function authenticate(event: FormEvent<HTMLFormElement>, unlock = false) {
    event.preventDefault(); accessVersion.current++; const form = new FormData(event.currentTarget);
    await safely(async () => {
      const name = String(form.get('name')), password = String(form.get('password'));
      await request(unlock || authMode === 'login' ? '/auth/login' : '/auth/setup', 'POST', unlock || authMode === 'login' ? { name, password, memberLogin:String(form.get('memberLogin')||'owner') } : { name, password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale, residenceCountry: 'ZZ', registrationPlatform: 'web', acknowledgedLocalUse: form.get('previewAck') === 'on' });
      await refresh(false); setModal(null); setAccountNotice(null); setPage(unlock ? parentDestination.current : 'home'); parentDestination.current = 'home'; window.scrollTo({ top: 0 });
    });
  }
  async function addProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    await safely(async () => {
      const c = await request<Child>('/children', 'POST', { alias: String(form.get('alias')), ageBand: String(form.get('ageBand')), locale: String(form.get('locale')), ...(me?.mode === 'local-development' ? {localConfirmation: form.get('confirmation') === 'on'} : {}) });
      await refresh(false); setSelected(c.id); setModal(null); setLocale(c.locale);
    });
  }
  function inviteToPractice(task: TaskId) {
    if (!child) { setModal('profile'); return; }
    if (!collectionStatusAllowsPractice(child.collectionStatus,child.consentActive)) { setError(collectionStatusCopy(child.collectionStatus,locale).detail); return; }
    setError(''); setPracticeInvitation({childId:child.id,task,identity:accessVersion.current}); setModal('practice-invitation');
  }
  async function start(invitation: NonNullable<typeof practiceInvitation>, event: MouseEvent<HTMLButtonElement>) {
    const candidate=me?.children.find(c=>c.id===invitation.childId);
    setModal(null); setPracticeInvitation(null);
    if (!candidate || invitation.identity !== accessVersion.current) { setError(t('家庭状态已更新，请重新选择练习。','Your family space changed. Choose the practice again.')); return; }
    if (!collectionStatusAllowsPractice(candidate.collectionStatus,candidate.consentActive)) { setError(collectionStatusCopy(candidate.collectionStatus,locale).detail); return; }
    await safely(async () => {
      const identity=++accessVersion.current;
      const s = await request<Session>(`/children/${candidate.id}/sessions`, 'POST', { task:invitation.task, deviceId: deviceId(), environment: environmentFor(inputForClick(event)) }, { 'Idempotency-Key': crypto.randomUUID() });
      if(identity!==accessVersion.current)return;
      await refresh(false);
      const active = await request<Session | null>('/sessions/active');if(identity===accessVersion.current&&mounted.current)setSession(active ?? s);
    });
  }
  async function observation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!child) return; const form = new FormData(e.currentTarget), identity = accessVersion.current;
    await safely(async () => {
      const input = { task: form.get('task'), context: form.get('context'), prompts: Number(form.get('prompts')), childChoice: form.get('choice') === 'on' };
      const body = JSON.stringify({ childId: child.id, input });
      if (observationAttempt.current?.body !== body) observationAttempt.current = { body, key: crypto.randomUUID() };
      await request(`/children/${child.id}/observations`, 'POST', input, { 'Idempotency-Key': observationAttempt.current.key });
      if(identity !== accessVersion.current || !mounted.current)return;
      observationAttempt.current = null;
      setModal(null); setNotice(t('生活小记录已保存。', 'Your everyday observation is saved.'));
      setReportRevision(value=>value+1);
    });
  }
  async function exportRecords() {
    if (!child) return;
    await safely(async () => {
      const data = await request(`/children/${child.id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'focus-family-records.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  if (session && (me||offlineOffer)) return <Play key={session.id} session={session} familyId={me?.family.id??offlineOffer!.capsule.familyId} offline={!!offlineOffer} onExit={() => { setSession(null); void refresh(false).catch(e => setError(e.message)); }} />;
  if (loading) return <div className="loading-screen"><Leaf size={32} /><p role="status">{t('正在打开家庭空间…', 'Opening your family space…')}</p></div>;
  if(offlineOffer&&!me)return <main className="offline-recovery"><section className="family-card stack-form"><span className="eyebrow">{isTeen(offlineOffer.capsule.session.plan.ageBand)?'FOCUS STUDIO':'FOCUS ISLAND'}</span><h1>{t('继续已准备的练习','Continue your prepared practice')}</h1><h2>{taskContent(offlineOffer.capsule.session.plan.task,locale,offlineOffer.capsule.session.plan.ageBand).title}</h2><p>{t('现在连接不上家庭服务。这里只恢复此浏览器已准备的练习，不会创建新的课程。','The family service is unavailable. Restore only the practice prepared in this browser; no new course session is created.')}</p><p>{t('可继续至：','Available until: ')}{new Date(offlineOffer.capsule.session.continuation_grant.body.recordUntil).toLocaleString(locale)}</p><p className="notice">{t('家长停止采集或换设备的通知，联网后才能收到。当前仍是未审核的本地开发内容。','Parent collection or device changes arrive when you reconnect. These remain unreviewed local preview materials.')}</p>{error&&<p className="notice error" role="alert">{error}</p>}<button className="primary" disabled={pending} onClick={()=>setSession(offlineOffer.capsule.session)}>{t('恢复这份练习','Restore this practice')}</button><button className="quiet" disabled={pending} onClick={()=>void safely(async()=>{await refresh();})}>{t('重新连接家庭服务','Reconnect to the family service')}</button><button className="quiet" disabled={pending} onClick={()=>void safely(async()=>{await journal().invalidate();setOfflineOffer(null);setSession(null);})}>{t('退出离线入口','Leave offline access')}</button></section></main>;

  if(unavailable&&!me)return <main className="offline-recovery"><section className="family-card stack-form"><span className="eyebrow">FOCUS ISLAND</span><h1>{t('重新连接，再一起开始','Reconnect before you begin')}</h1><p>{error||t('家庭服务暂时无法连接，此浏览器没有可恢复的练习。未到期的本机记录会保留。','The family service is unavailable and this browser has no practice to restore. Unexpired local records are preserved.')}</p><button className="primary" disabled={pending} onClick={()=>void safely(async()=>{await refresh();})}>{pending?t('正在连接…','Connecting…'):t('重新连接家庭服务','Reconnect to the family service')}</button></section></main>;

  const authFields = (unlock = false) => <form onSubmit={e => void authenticate(e, unlock)} className="stack-form">
    <label>{t('家庭名称', 'Family name')}<input name="name" required maxLength={40} defaultValue={unlock ? me?.family.name : ''} autoComplete="username" placeholder={t('给你们的空间起个名字', 'A name for your space')} /></label>
    {(unlock || authMode === 'login') && <label>{t('家长登录名', 'Parent username')}<input name="memberLogin" required defaultValue={me?.member?.loginName ?? 'owner'} maxLength={32} autoComplete="username" /><small>{t('创建者使用 owner；受邀家长使用自己设置的登录名。','Creators use owner; invited parents use the username they chose.')}</small></label>}
    <label>{t('家长密码', 'Parent password')}<input name="password" type="password" required minLength={unlock || authMode === 'login' ? 1 : 15} maxLength={128} autoComplete={unlock || authMode === 'login' ? 'current-password' : 'new-password'} placeholder={unlock || authMode === 'login' ? '' : t('至少 15 个字符', 'At least 15 characters')} /></label>
    {!unlock && authMode === 'setup' && <label className="check-label"><input name="previewAck" type="checkbox" required />{hostedPreview ? t('我会只用虚构资料测试，知道记录会保存到受保护的云端家庭服务；这不是正式开放给真实家庭的产品。', 'I will use fictional test details only. I understand records are saved in a protected cloud family service and this is not open to real families.') : t('我知道这是本机开发体验，并会在孩子愿意时陪伴尝试。', 'I understand this is a local development preview and will invite my child to take part voluntarily.')}</label>}
    {error && <div className="notice error" role="alert">{error}</div>}
    <button className="primary large" disabled={pending}>{pending ? t('请稍等…', 'One moment…') : unlock || authMode === 'login' ? t('进入家庭空间', 'Open family space') : t('建立我们的空间', 'Create our space')}<ArrowRight size={18} /></button>
  </form>;

  if (!me) return <div className="welcome-page"><header className="welcome-header"><div className="wordmark"><span className="logo-mark"><Leaf /></span><div>{t('专注岛', 'Focus Island')}<small>SPACE TO GROW</small></div></div><button className="quiet" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}><Globe2 size={17} />{locale === 'en' ? '简体中文' : 'English'}</button></header><main className="welcome-layout"><section className="welcome-story"><span className="eyebrow">{t('为每个家庭，留一处从容', 'A little room to grow, together')}</span><h1>{t('专注于眼前，', 'Find your focus.')}<br />{t('慢慢长出力量。', 'Grow at your pace.')}</h1><p>{t('短短几分钟，练习一个小策略。然后，把它带回真实的生活。', 'A few calm minutes to practise one useful strategy. Then take it into everyday life.')}</p><img src={hero} width={896} height={896} decoding="async" alt="" /><div className="welcome-values"><span><Check size={16} />{t('6–17 岁分龄设计', 'Designed for ages 6–17')}</span><span><Check size={16} />{t('没有排名和广告', 'No rankings or ads')}</span></div></section><section className="auth-card"><div className="segmented"><button disabled={pending} className={authMode === 'setup' ? 'selected' : ''} onClick={() => { setAuthMode('setup'); setError(''); }}>{t('第一次来', 'New here')}</button><button disabled={pending} className={authMode === 'login' ? 'selected' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>{t('回到小岛', 'Welcome back')}</button><button disabled={pending} className={authMode === 'join' ? 'selected' : ''} onClick={() => { setAuthMode('join'); setError(''); }}>{t('接受邀请','Accept invitation')}</button></div><h2>{authMode === 'setup' ? t('从一个家庭空间开始', 'Start with a family space') : authMode === 'join' ? t('一起支持孩子成长','Support your child together') : t('很高兴再次见到你', 'Good to see you again')}</h2><p className="subtle">{t('由家长建立空间，再为孩子选择适合的体验。', 'A parent sets up the space and chooses an experience for each child.')}</p>{accountNotice && <p className="notice" role="status">{accountNotice === 'password' ? securityCopy(locale).changed : accountNotice === 'signout' ? securityCopy(locale).signedOut : accountNotice === 'deleted' ? securityCopy(locale).deleted : accountNotice === 'deleted-local-pending' ? securityCopy(locale).deletedLocalPending : accountNotice === 'delete-uncertain' ? securityCopy(locale).deletionUncertain : accountNotice === 'uncertain' ? securityCopy(locale).uncertain : securityCopy(locale).ended}</p>}{authMode === 'join' ? <Suspense fallback={<p role="status">{t('正在打开…','Opening…')}</p>}><JoinFamily locale={locale} onBusyChange={setPending} onJoined={async () => { await refresh(false); setAccountNotice(null); setPage('home'); }} /></Suspense> : authFields()}<div className="local-note"><ShieldCheck size={18} /><p>{hostedPreview ? t('受限线上预览：请勿填写真实儿童资料。测试记录保存在云端家庭服务；尚未开放正式家庭使用。', 'Restricted hosted preview: do not enter real child details. Test records are stored in a cloud family service. Not yet open to families.') : t('本机开发版。记录保存在这台电脑的家庭服务中；尚未开放正式商业服务。', 'Local development preview. Records stay in the family service on this computer. Not yet a commercial release.')}</p></div></section></main></div>;

  if(me.role === 'parent' && me.member?.state === 'pending') return <main className="offline-recovery"><section className="family-card stack-form"><h1>{t('等待家庭创建者确认','Waiting for the family creator')}</h1><p>{me.family.name} · {me.member.displayName} · {me.member.loginName}</p><p>{t('请与创建者核对登录名。确认之前，这里不会显示孩子资料。','Check your username with the creator. Child records stay hidden until they confirm.')}</p>{error&&<p role="alert">{error}</p>}<button className="primary" disabled={pending} onClick={()=>void safely(async()=>{await refresh(false);})}>{t('重新读取','Reload')}</button><button className="quiet" onClick={()=>void safely(async()=>{await request('/auth/logout','POST',{});accountEnded('signin');})}>{t('退出登录','Sign out')}</button></section></main>;

  const navigation = ([['home', Compass, t('今日探索', 'Today')], ['life', Leaf, t('生活小目标', 'Everyday goals')], ['limits', Clock3, t('练习与休息', 'Practice & rest')], ['report', BarChart3, t('成长记录', 'Our progress')], ['family', Users, t('家庭空间', 'Family space')], ['guide', BookOpen, t('家长陪伴小课', 'Parent guide')], ['method', BookOpen, t('方法与陪伴', 'Our approach')]] as const).filter(([id])=>!support || id!=='life');
  const primaryNavigation = navigation.filter(([id]) => ['home', support ? 'limits' : 'life', 'report'].includes(id));
  const recommended = child?.course.task ?? 'search', meta = taskContent(recommended, locale, child?.ageBand);
  const practiceAllowed = !!child && child.ageReview.state==='current' && collectionStatusAllowsPractice(child.collectionStatus,child.consentActive);
  return <div key={me.member?.id ?? me.role} className={`app-layout ${teen ? 'teen' : ''}`}>
    <a className="skip-link" href="#main-content">{t('跳到当前页面内容', 'Skip to page content')}</a><aside className="sidebar"><a className="wordmark" href="#" onClick={e => { e.preventDefault(); navigate('home'); }}><span className="logo-mark"><Leaf /></span><div>{teen ? 'Focus Studio' : t('专注岛', 'Focus Island')}<small>SPACE TO GROW</small></div></a><div className="nav-label">{t('我们的空间', 'OUR SPACE')}</div><nav aria-label={t('主导航', 'Main navigation')}>
      {navigation.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={20} />{label}{(id === 'report' || id === 'family' || id === 'guide') && me.role === 'child' && <LockKeyhole size={13} />}</button>)}
    </nav><div className="sidebar-note"><Leaf size={24} /><p>{t('每次一小步，', 'One small step.')}<br />{t('也值得被看见。', 'Worth noticing.')}</p></div><div className="sidebar-account"><span className="avatar small">{me.family.name.slice(0, 1)}</span><div><strong>{me.family.name}</strong><small>{me.role === 'parent' ? t('家长空间已解锁', 'Parent space unlocked') : t('孩子的探索时间', 'Your own exploring time')}</small></div></div></aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><span className="breadcrumb-root">{t('家庭成长空间', 'Your family space')}</span><span className="breadcrumb-separator">/</span>{page === 'home' ? t('今日探索', 'Today') : page === 'limits' ? t('练习与休息', 'Practice & rest') : page === 'guide' ? t('家长陪伴小课', 'Parent guide') : page === 'recovery' ? t('未结束练习', 'Unfinished practice') : page === 'life' ? t('生活小目标', 'Everyday goals') : page === 'report' ? t('成长记录', 'Progress') : page === 'strategy' ? t('我的策略足迹', 'My strategy trail') : page === 'family' ? t('家庭空间', 'Family') : t('方法与陪伴', 'Our approach')}</div><div className="topbar-actions"><span className="preview-chip">{me.mode === 'local-development' ? hostedPreview ? t('线上测试预览', 'Hosted test preview') : t('本机预览', 'Local preview') : t('监护核验', 'Guardian verification')}</span><button className="quiet" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')} aria-label={t('切换到英文', 'Switch to Chinese')}><Globe2 size={17} />{locale === 'en' ? '中' : 'EN'}</button><button className="avatar small" aria-label={t('家长验证', 'Parent access')} onClick={() => setModal('login')}><LockKeyhole size={17} /></button></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}><div className="page-heading"><div><span className="eyebrow">{page === 'home' ? 'A LITTLE FOCUS, EVERY DAY' : 'GROW TOGETHER'}</span><h1 id="page-title" ref={pageTitle} tabIndex={-1}>{page === 'home' ? t('今天，发现一点小进步', 'A small discovery today') : page === 'limits' ? t('把休息也安排进来', 'Make room for rest') : page === 'guide' ? t('给孩子留空间，也给家长方法', 'Room for your child, support for you') : page === 'recovery' ? t('记录留好，再安心继续', 'Preserve the record, then continue') : page === 'life' ? t('把一个小策略，带到生活里', 'Take one small strategy into everyday life') : page === 'report' ? t('看见尝试，也看见方法', 'Notice the effort and the strategy') : page === 'strategy' ? t('回看我试过的策略', 'Look back at strategies I tried') : page === 'family' ? t('每个孩子，都有自己的节奏', 'A different pace for every child') : t('陪伴，从理解开始', 'Support starts with understanding')}</h1></div><div className="profile-switcher">{me.children.map((c, i) => <button key={c.id} aria-pressed={child?.id === c.id} className={child?.id === c.id ? 'selected' : ''} onClick={() => { accessVersion.current++; setSelected(c.id); setLocale(c.locale); setNotice(''); }}><span className={`avatar tone-${i}`}>{c.alias.slice(0, 1)}</span><span>{c.alias}<small>{c.ageBand}{t(' 岁', ' years')}</small></span></button>)}{owner && me.children.length < 3 && <button className="add-profile" onClick={() => setModal('profile')} aria-label={t('添加孩子', 'Add a child')}><Plus size={18} /></button>}</div></div>
      {error && !modal && <div className="notice error" role="alert">{error}<button className="icon-button" onClick={() => setError('')} aria-label="Close"><X size={16} /></button></div>}{notice && <div className="notice" role="status">{notice}</div>}
      {!child && owner && <section className="empty-state"><div className="feedback-icon"><Users size={36} /></div><h2>{t('先认识一下今天的小探索家', 'Meet your first explorer')}</h2><p>{t('一个昵称和年龄段就够了，不需要真实姓名、照片或学校。', 'A nickname and age band are enough. No real name, photo or school needed.')}</p><button className="primary" onClick={() => setModal('profile')}><Plus size={18} />{t('建立孩子档案', 'Add a child')}</button></section>}
      {child && page === 'home' && <button className="quiet" onClick={() => navigate('recovery')}>{t('未结束练习与换设备', 'Unfinished practice & changing devices')}</button>}
      {child && teen && me.role === 'child' && page === 'strategy' && <Suspense fallback={<p role="status">{t('正在读取策略足迹…', 'Reading your strategy trail…')}</p>}><TeenStrategyHistory key={`${me.family.id}:${child.id}`} child={child} locale={locale} onBack={() => navigate('home')} /></Suspense>}
      {child && page === 'recovery' && me.role === 'parent' && <Suspense fallback={<p role="status">{t('正在读取恢复信息…', 'Loading recovery information…')}</p>}><Recovery key={`${me.family.id}:${child.id}`} childId={child.id} locale={locale} onRequireLogin={() => { parentDestination.current = 'recovery'; setModal('login'); }} onResume={async id => {
        const version = accessVersion.current;
        const restored = await request<Session>(`/children/${child.id}/recovery/${id}/resume`, 'POST', {deviceId:deviceId()});
        if(version !== accessVersion.current) { await refresh(false); return; }
        const next = await refresh(false);
        if(version === accessVersion.current && next?.role === 'child' && next.children[0]?.id === child.id) setSession(restored);
      }} /></Suspense>}
      {child && page === 'guide' && me.role === 'parent' && <Suspense fallback={<p role="status">{t('正在打开家长陪伴小课…', 'Opening the parent guide…')}</p>}><ParentGuide canChooseGoal={!support} key={`${me.family.id}:${child.id}`} childId={child.id} locale={locale} onLogin={() => { parentDestination.current = 'guide'; setModal('login'); }} onLife={templateId => { navigate('life'); setLifeSuggestion({childId: child.id, templateId}); }} /></Suspense>}
      {child && !support && page === 'life' && !child.collectionStatus && <p className="notice" role="status">{collectionStatusCopy(child.collectionStatus,locale).detail}</p>}
      {child && !support && page === 'life' && !!child.collectionStatus && <Suspense fallback={<p role="status">{t('正在打开生活小目标…', 'Opening everyday goals…')}</p>}><LifeGoals key={`${me.family.id}:${child.id}:${me.role}`} childId={child.id} role={me.role} locale={locale} initialTemplate={lifeSuggestion?.childId === child.id ? lifeSuggestion.templateId : undefined} entering={pending} onEnterChild={() => void safely(async () => {
        await request(`/children/${child.id}/enter`, 'POST', {});
        await refresh(false); setPage('life');
      })} /></Suspense>}
      {child && page === 'limits' && <Suspense fallback={<p role="status">{t('正在读取安排…', 'Loading your plan…')}</p>}><PracticeLimits support={support} key={`${me.family.id}:${child.id}:${me.role}`} childId={child.id} parent={owner} locale={locale} onParent={() => { parentDestination.current = 'limits'; setModal('login'); }} allowLife={!support} onLife={() => navigate('life')} onRecovery={() => navigate('recovery')} /></Suspense>}
      {child && page === 'home' && <>
        {child.ageReview.state!=='current'&&<p className="notice" role="status">{me.role==='parent'?t('年龄档需要复核。新练习暂停；请到家庭空间核对。','The age band needs review. New practice is paused; check the family space.'):t('家庭正在更新适合你的安排。完成的记录还在。','Your family is updating your plan. Your saved records are still here.')}</p>}
        {!practiceAllowed && <p className="notice" role="status">{collectionStatusCopy(child.collectionStatus,locale).detail}</p>}
        {me.role === 'child' && <button className="quiet child-data-entry" onClick={() => setModal('child-data-visibility')}><ShieldCheck size={18} aria-hidden="true" />{childDataVisibilityCopy(child.ageBand, locale).title}<ArrowRight size={17} aria-hidden="true" /></button>}
        {me.role === 'child' && teen && <button className="quiet child-data-entry" onClick={() => navigate('strategy')}><BookOpen size={18} aria-hidden="true" />{t('我的策略足迹', 'My strategy trail')}<ArrowRight size={17} aria-hidden="true" /></button>}
        <section className="today-hero"><div className="today-copy"><div className="pill"><span className="dot" />{child.course.complete ? t('已完成八周基础课程', 'Eight-week foundation complete') : t(`第 ${child.course.week} 周 · 个人课程`, `Week ${child.course.week} · Your course`)}</div><h2>{teen ? t('让注意力，回到这一刻。', 'Bring your focus to this moment.') : t('和小岛朋友一起，', 'A little adventure,')}<br />{!teen && t('认真做好一件小事。', 'one small thing at a time.')}</h2><p>{t(`${child.alias}，今天试试「${meta.skill}」。不用比快，找一个适合自己的方法。`, `${child.alias}, let’s try “${meta.skill.toLowerCase()}”. Take your time and discover a strategy that works for you.`)}</p><div className="hero-action"><button className="primary large" disabled={pending || !practiceAllowed} onClick={() => inviteToPractice(recommended)}>{child.course.complete ? t('选择一段巩固练习', 'Choose a little practice') : t('开始今天的小练习', 'Start today’s practice')}<ArrowRight size={20} /></button><span><Clock3 size={15} />{t('约 4–6 分钟', 'About 4–6 minutes')}</span></div></div>{teen ? <div className="teen-art" aria-hidden="true"><div className="orbit one" /><div className="orbit two" /><div className="orbit three" /><span>ONE<br />THING<br /><em>at a time.</em></span></div> : <img className="hero-island" src={hero} width={896} height={896} decoding="async" alt="" />}</section>
        <div className="home-columns"><section className="course-card"><div className="section-label"><h3>{t('这周的三次小探索', 'Three small explorations')}</h3><span>{child.course.weekDone} / 3</span></div><div className="week-steps">{Array.from({ length: 3 }, (_, i) => <div key={i} className={i < child.course.weekDone ? 'done' : ''}><span>{i < child.course.weekDone ? <Check size={17} /> : `0${i + 1}`}</span><strong>{[t('认识策略', 'Discover'), t('再试一次', 'Try again'), t('带进生活', 'Take it further')][i]}</strong><small>{i < child.course.weekDone ? t('已尝试', 'Tried') : t('按自己的节奏', 'At your own pace')}</small></div>)}</div><p className="subtle">{child.course.complete ? t('基础课程已经走完。可以休息，也可以选择感兴趣的策略巩固。', 'The foundation is complete. Take a break or revisit a strategy you enjoy.') : t('课程按推荐任务推进。自由探索也会记录，不用赶进度。', 'Recommended tasks move the course forward. Free-choice practice is recorded too. No rush.')}</p></section><section className="life-card"><div className="section-label"><h3><Leaf size={17} />{t('屏幕之外的小练习', 'Beyond the screen')}</h3><ArrowUpRight size={18} /></div>{!teen && <img className="life-bridge" src={bridge} width={960} height={480} loading="lazy" decoding="async" alt="" />}<p>{meta.transfer}</p>{!support&&<button className="primary" disabled={!child.collectionStatus} onClick={() => navigate('life')}>{t('一起商量一个小目标', 'Choose an everyday goal together')}<ArrowRight size={16} /></button>}<button className="text-button" disabled={!practiceAllowed} onClick={() => me.role === 'parent' ? setModal('observation') : setModal('login')}>{t('和家长记录一次尝试', 'Record an attempt with a parent')}<ArrowRight size={16} /></button></section></div>
        <div className="section-title"><div><h2>{t('四种策略，四段探索', 'Four strategies to explore')}</h2><p>{t('选一个感兴趣的，先试一小轮。', 'Choose something that interests you. Try one little step first.')}</p></div><span className="subtle">{t('每天适量练习', 'Keep it short and comfortable')}</span></div><div className="task-cards">{TASKS.map((task, i) => { const item = taskContent(task, locale, child.ageBand), Icon = taskIcons[task]; return <button key={task} className={`task-card ${item.color}`} disabled={pending || !practiceAllowed} onClick={() => inviteToPractice(task)}><div className="task-card-top"><span>0{i + 1}</span><Icon size={22} /></div><div className="task-card-art">{task === 'search' ? <><Stimulus item="fox" locale={locale} teen={teen} /><Stimulus item="rabbit" locale={locale} teen={teen} /></> : task === 'memory' ? <><Stimulus item="apple" locale={locale} /><Stimulus item="leaf" locale={locale} /></> : <Stimulus item={task === 'stop' ? 'rabbit' : 'star'} locale={locale} teen={teen} />}</div><div className="task-card-copy"><span>{item.skill}</span><h3>{item.title}</h3><p>{item.strategy}</p><div><span><Clock3 size={13} />{item.minutes} {t('分钟左右', 'minutes')}</span><span className="card-arrow"><ArrowRight size={18} /></span></div></div></button>; })}</div>
        <div className="gentle-note"><ShieldCheck size={19} /><p>{t('我们记录的是具体任务中的尝试，不给孩子打“专注力总分”。', 'We record attempts in specific tasks, without giving your child an “attention score”.')}</p><button className="text-button" onClick={() => navigate('method')}>{t('了解方法', 'Our approach')}<ArrowUpRight size={15} /></button></div>
      </>}
      {child && me.role === 'parent' && page === 'report' && <Suspense fallback={<p role="status">{t('正在整理记录…','Loading your records…')}</p>}><RecordHistory key={`${me.family.id}:${me.member?.id}:${child.id}`} child={child} locale={locale} owner={owner} revision={reportRevision} onExport={()=>void exportRecords()} onObserve={()=>setModal('observation')} onRequireParent={()=>{parentDestination.current='report';setModal('login');}} /></Suspense>}
      {page === 'family' && <><section className="family-card"><div className="section-title"><h2>{t('家庭成员', 'Your family')}</h2>{owner && me.children.length < 3 && <button className="quiet" onClick={() => setModal('profile')}><Plus size={17} />{t('添加孩子', 'Add a child')}</button>}</div>{me.children.map((c, i) => <div className="family-row" key={c.id}><span className={`avatar tone-${i}`}>{c.alias.slice(0, 1)}</span><div><strong>{c.alias}</strong><p>{c.ageBand}{t(' 岁', ' years')} · {c.locale === 'zh-CN' ? '简体中文' : 'English'} · {collectionStatusCopy(c.collectionStatus,locale).short}</p><LocalJournalWarning familyId={me.family.id} childId={c.id} locale={locale}/></div>{owner&&<button className="quiet" onClick={() => { setSelected(c.id); setModal('privacy'); }}>{t('数据与权限', 'Data & access')}<ArrowRight size={16} /></button>}</div>)}</section>{child&&<Suspense fallback={<p role="status">{t('正在读取年龄档…','Loading age band…')}</p>}><AgeReview key={child.id} child={child} locale={locale} owner={owner} mode={me.mode} onRefresh={()=>refresh(false)} onParent={()=>{parentDestination.current='family';setModal('login');}}/></Suspense>}<section className="family-card"><h2>{t('家长账号', 'Parent account')}</h2><p className="subtle">{t('网页版本', 'Web version')} {import.meta.env.VITE_APP_VERSION}</p><p>{t('进入练习后，家长权限会锁定。返回家长空间需要重新输入密码。', 'Starting practice locks parent access. Enter your password again to return to parent features.')}</p><div className="family-row"><div><strong>{me.family.name}</strong><p>{me.family.timezone}</p></div><button className="quiet" onClick={() => void safely(async () => { await clearChildJournals(); await request('/auth/logout', 'POST', {}); setMe(null);  setSelected(''); })}><LogOut size={17} />{t('退出并清除本机缓存', 'Sign out and clear cached records')}</button></div></section><Suspense fallback={<p role="status">{securityCopy(locale).loading}</p>}><>{me.member && <FamilyMembers familyId={me.family.id} viewerId={me.member.id} children={me.children} locale={locale} onSignIn={() => { parentDestination.current='family'; setModal('login'); }} />}<AccountSecurity key={me.family.id} familyId={me.family.id} familyName={me.family.name} childIds={me.children.map(c => c.id)} locale={locale} onSignIn={() => accountEnded('signin')} /></></Suspense></>}
      {page === 'method' && <section className="method-card"><span className="eyebrow">SMALL PRACTICE. EVERYDAY STRATEGIES.</span><h2>{t('让练习，真的和生活有关', 'Connect practice to everyday life')}</h2><p className="lead">{t('看见目标、看清再行动、记住顺序、短段留意。每一次练习只尝试一个可以说清楚的方法。', 'Notice a target, pause before acting, remember a sequence, and stay with a short task. Each practice introduces one clear strategy.')}</p><div className="method-steps">{[t('先理解规则', 'Understand the rule'), t('短短练习一会儿', 'Practise briefly'), t('带回生活试一试', 'Try it in everyday life')].map((v, i) => <div key={v}><span>0{i + 1}</span><h3>{v}</h3><p>{[t('用示范确认孩子真的明白，不用错误堆积成挫败。', 'Use examples to check understanding before moving on.'), t('不排名、不追求速度。孩子可以随时暂停或结束。', 'No rankings or rushing. Your child can pause or stop.'), t('选择一件具体的小事，观察用了什么方法，而不是评价性格。', 'Choose one small task. Notice the strategy, not a personality label.')][i]}</p></div>)}</div><h3>{t('我们怎样看待进步', 'What progress means here')}</h3><p>{t('程序记录的是任务中的表现。训练能否改善日常功能，需要本产品自身的严谨研究；当前不提供诊断或已验证的治疗。', 'The app records performance in its tasks. Everyday benefits require rigorous research on this product. This preview does not provide diagnosis or a validated treatment.')}</p><h3>{t('为什么声音不会和孩子聊天', 'Why the voice does not chat')}</h3><p>{t('我们使用事先制作的固定语音素材，规则与文案可检查。不会在练习中调用实时大模型，也不采集孩子的声音。', 'We use pre-produced voice files so instructions can be reviewed. No live language model is called during practice and no child audio is collected.')}</p><div className="notice">{hostedPreview ? t('当前为受限线上开发预览，仅使用虚构资料。全球发布、适龄验证和完整专业审核仍在进行。', 'This is a restricted hosted preview for fictional test details only. Global release, age suitability and professional review are still pending.') : t('当前为本地开发体验。全球发布、适龄验证和完整专业审核仍在进行。', 'This is a local development preview. Global release, age suitability and professional review are still pending.')}</div></section>}
      <footer className="app-footer"><span><Leaf size={14} />{t('为成长留一点从容', 'Give growth a little room')}</span><span>{me.mode === 'local-development' ? hostedPreview ? t('云端测试记录 · 无广告 · 可随时结束', 'Cloud test records · No ads · Stop anytime') : t('本机保存 · 无广告 · 可随时结束', 'Saved locally · No ads · Stop anytime') : t('无广告 · 可随时结束', 'No ads · Stop anytime')}</span></footer>
      </main>
    </div>
    <nav className="mobile-navigation" aria-label={t('常用页面', 'Quick navigation')}>
      {primaryNavigation.map(([id, Icon, label]) => <button key={id} onClick={() => navigate(id)} aria-label={label} aria-current={page === id ? 'page' : undefined}><Icon size={22} aria-hidden="true" /><span>{id === 'home' ? t('探索', 'Today') : id === 'life' ? t('生活', 'Goals') : id === 'limits' ? t('休息', 'Rest') : t('记录', 'Progress')}</span></button>)}
      <button className={!primaryNavigation.some(([id]) => id === page) ? 'active' : undefined} aria-label={t('更多页面', 'More pages')} aria-haspopup="dialog" aria-expanded={modal === 'navigation'} onClick={() => setModal('navigation')}><MoreHorizontal size={22} aria-hidden="true" /><span>{t('更多', 'More')}</span></button>
    </nav>
    {modal === 'navigation' && <Dialog locale={locale} navigation title={t('想去哪里？', 'Where next?')} onClose={() => setModal(null)}><nav className="navigation-menu" aria-label={t('全部页面', 'All pages')}>{navigation.map(([id, Icon, label]) => <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => { setModal(null); navigate(id); }}><Icon size={21} aria-hidden="true" /><span>{label}</span>{['report', 'family', 'guide'].includes(id) && me.role === 'child' ? <span className="navigation-access"><LockKeyhole size={15} aria-hidden="true" />{t('家长', 'Parent')}</span> : page === id ? <Check size={19} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</button>)}</nav></Dialog>}
    {modal === 'practice-invitation' && practiceInvitation && invitedChild && <Dialog locale={invitedChild.locale} title={practiceInvitationCopy(invitedChild.ageBand,invitedChild.locale).title} onClose={() => { setModal(null); setPracticeInvitation(null); }}><div className="practice-invitation" lang={invitedChild.locale}><p className="practice-invitation-task">{taskContent(practiceInvitation.task,invitedChild.locale,invitedChild.ageBand).title}</p><p>{practiceInvitationCopy(invitedChild.ageBand,invitedChild.locale).body}</p>{me.role === 'parent' && <p className="subtle">{practiceInvitationCopy(invitedChild.ageBand,invitedChild.locale).parentHint}</p>}<div className="practice-invitation-actions"><button type="button" className="primary" disabled={pending} onClick={event => void start(practiceInvitation,event)}>{practiceInvitationCopy(invitedChild.ageBand,invitedChild.locale).begin}</button><button type="button" className="quiet" disabled={pending} onClick={() => { setModal(null); setPracticeInvitation(null); }}>{practiceInvitationCopy(invitedChild.ageBand,invitedChild.locale).later}</button></div></div></Dialog>}
    {modal === 'child-data-visibility' && child && me.role === 'child' && <Dialog locale={locale} title={childDataVisibilityCopy(child.ageBand, locale).title} onClose={() => setModal(null)}><div className="child-data-visibility"><p>{childDataVisibilityCopy(child.ageBand, locale).introduction}</p>{(['practice', 'reflection', 'control'] as const).map(section => <section key={section}><h3>{childDataVisibilityCopy(child.ageBand, locale)[`${section}Heading`]}</h3><p>{childDataVisibilityCopy(child.ageBand, locale)[section]}</p></section>)}<p className="notice">{childDataVisibilityCopy(child.ageBand, locale).device}</p><button type="button" className="primary" onClick={() => setModal(null)}>{childDataVisibilityCopy(child.ageBand, locale).close}</button></div></Dialog>}
    {modal === 'profile' && owner && <Dialog locale={locale} title={t('认识一位小探索家', 'Meet an explorer')} onClose={() => setModal(null)}><form className="stack-form" onSubmit={e => void addProfile(e)}><p className="subtle">{t('昵称就够了。每个孩子的练习与记录各自保存。', 'A nickname is enough. Each child gets their own practice and records.')}</p><label>{t('孩子的昵称', 'Child’s nickname')}<input name="alias" autoFocus required maxLength={24} placeholder={t('例如：小树', 'For example: River')} /></label><label>{t('年龄段', 'Age band')}<select name="ageBand" defaultValue="6-8">{['6-8', '9-11', '12-14', '15-17'].map(v => <option key={v} value={v}>{v} {t('岁', 'years')}</option>)}</select></label><label>{t('练习语言', 'Practice language')}<select name="locale" defaultValue={locale}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>{me.mode === 'local-development' ? <label className="check-label"><input name="confirmation" type="checkbox" required />{hostedPreview ? t('我会只用虚构孩子昵称测试，知道新练习记录保存在云端，并会让参与测试的孩子每次自行选择是否参加。', 'I will use a fictional child nickname, understand that new practice records are stored in the cloud, and let any child taking part in testing choose each time whether to join.') : t('我同意在这台电脑保存本地测试记录，并会让孩子在每次练习前自己选择是否参加。', 'I agree to save local test records on this computer and let my child choose whether to take part before each practice.')}</label> : <p className="notice">{t('建立档案后仍需完成适用的监护核验，才能开始练习。当前版本尚未开放核验入口。', 'This profile will need guardian verification before practice. Verification is not yet available in this version.')}</p>}{error && <p className="notice error" role="alert">{error}</p>}<button className="primary" disabled={pending}>{t('为孩子准备好', 'Prepare their space')}<ArrowRight size={18} /></button></form></Dialog>}
    {modal === 'login' && <Dialog locale={locale} title={t('回到家长空间', 'Return to parent space')} onClose={() => setModal(null)}><p className="subtle">{t('家庭资料和设置需要家长密码。', 'Family records and settings need your parent password.')}</p>{authFields(true)}</Dialog>}
    {modal === 'observation' && child && practiceAllowed && <Dialog locale={locale} title={t('记下一次生活中的尝试', 'An everyday attempt')} onClose={() => setModal(null)}><form className="stack-form" onSubmit={e => void observation(e)}><label>{t('尝试了哪个策略', 'Which strategy?')}<select name="task" defaultValue={recommended}>{TASKS.map(k => <option value={k} key={k}>{taskContent(k, locale, child.ageBand).skill}</option>)}</select></label><label>{t('做了什么小事', 'What was the activity?')}<select name="context"><option value="packing">{t('准备物品', 'Getting things ready')}</option><option value="tidying">{t('整理小空间', 'Tidying a space')}</option><option value="reading">{t('短段阅读', 'A little reading')}</option><option value="project">{t('个人小项目', 'A small project')}</option></select></label><label>{t('大约提醒了几次', 'How many reminders?')}<input type="number" name="prompts" min={0} max={20} defaultValue={0} required /></label><label className="check-label"><input name="choice" type="checkbox" />{t('这个任务由孩子自己选择', 'The child chose this activity')}</label><p className="subtle">{t('只记录具体事件，不用这一条记录判断训练是否有效。', 'One observation cannot tell us whether training caused a change.')}</p><button className="primary" disabled={pending}>{t('保存这次观察', 'Save observation')}<Check size={18} /></button></form></Dialog>}
    {modal === 'privacy' && owner && child && <Dialog locale={locale} title={`${child.alias} · ${t('数据与权限', 'Data & access')}`} onClose={() => setModal(null)}><div className="stack-form"><p>{me.mode === 'local-development' ? hostedPreview ? t('测试记录保存在云端家庭服务。你可以导出记录、停止新数据采集，或删除这个档案和相关练习。', 'Test records are stored in a cloud family service. Export them, stop new collection, or delete this profile and its practice records.') : t('记录保存在本机家庭服务。你可以导出记录、停止新数据采集，或删除这个档案和相关练习。', 'Records are stored in your local family service. Export them, stop new collection, or delete this profile and its practice records.') : t('你可以导出记录、停止新数据采集，或删除这个档案和相关练习。', 'You can export records, stop new collection, or delete this profile and its practice records.')}</p><p className="notice">{collectionStatusCopy(child.collectionStatus,locale).detail}</p><button className="quiet" onClick={() => void exportRecords()} disabled={pending}><Download size={17} />{t('导出此档案记录', 'Export this profile')}</button><button className="quiet" disabled={pending} onClick={() => void safely(async () => { await request(`/children/${child.id}/withdraw`, 'POST', {}); await clearChildJournals(child.id); await refresh(false); setModal(null); setNotice(t('已停止采集，新练习和旧设备补传都会被拒绝。', 'Collection stopped. New practice and uploads from old sessions are blocked.')); })}>{t('停止此档案的数据采集', 'Stop collection for this profile')}</button><form className="stack-form danger-zone" onSubmit={e => { e.preventDefault(); if (new FormData(e.currentTarget).get('confirmation') !== child.alias) { setError(t('请完整输入孩子的昵称。', 'Please enter the exact nickname.')); return; } void safely(async () => { await request(`/children/${child.id}`, 'DELETE'); await clearChildJournals(child.id); await refresh(false); setModal(null);  setNotice(t('档案、关联记录和此浏览器中的缓存已删除。', 'The profile, linked records and cached records in this browser have been deleted.')); }); }}><label>{t('删除前，输入孩子昵称确认', 'To delete, enter the nickname')}<input name="confirmation" required placeholder={child.alias} /></label><button className="danger-button" disabled={pending}>{t('删除此档案和记录', 'Delete profile and records')}</button></form>{error && <p className="notice error" role="alert">{error}</p>}</div></Dialog>}
  </div>;
}
