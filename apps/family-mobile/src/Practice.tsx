import { useEffect, useRef, useState } from 'react';
import { Platform, AccessibilityInfo, ActivityIndicator, AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { SessionRuntime, phaseAfterTrial, remainingInterval } from '../../../packages/session-runtime/index.ts';
import { TrialLifecycle } from '../../../packages/session-runtime/trial-lifecycle.ts';
import { AuthorizationError } from '../../../packages/session-runtime/authorization.ts';
import type { ContinuationClock } from '../../../packages/session-runtime/authorization.ts';
import { prepareAuthorization } from '../../../packages/session-runtime/prepare-authorization.ts';
import type { AuthorizationProof, SessionStatus } from '../../../packages/session-runtime/prepare-authorization.ts';
import { nativeVerifier } from '../../../packages/content/native-verifier.ts';
import { metrics, TIMING } from '../../../packages/task-engine/index.ts';
import type { Action, Replay } from '../../../packages/task-engine/index.ts';
import type { Session, Result } from '../../../packages/contracts/models.ts';
import { isTeen, translate, itemLabel } from '../../../packages/content/copy.ts';
import { feedbackGuidance, searchTargetPositions } from '../../../packages/content/feedback.ts';
import { MobileClient, MobileRequestError, unavailable } from './client';
import { prepareContent } from './content';
import type { MobileContent } from './content';
import { journalFor, removeChildJournals, offlineGeneration, saveOfflineSession, readOfflineSession, dropOfflineSession, checkpointOffline } from './storage';
import { Stimulus } from './Stimulus';
import { RuleExamples } from './RuleExamples';
import { Page, Button, Notice, s, colors } from './ui';

import { makeOfflineCapsule, verifyOfflineSession, isNetworkFailure, OfflinePreparationChanged } from '../../../packages/session-runtime/offline-session.ts';

import { PracticeCheckIn, practiceWindowCopy } from '../../../packages/session-runtime/practice-window.ts';
import { backgroundPauseCopy, shouldPauseForBackground } from '../../../packages/session-runtime/background-pause-copy.ts';
import type { PracticePhase } from '../../../packages/session-runtime/practice-window.ts';
type Phase = PracticePhase;
export function Practice({ session, familyId, client, offline = false, onExit, onExploreLife }: { session: Session; familyId: string; client: MobileClient; offline?: boolean; onExit(): void; onExploreLife?(): void }) {
  const plan = session.plan, t = translate(plan.locale), teen = isTeen(plan.ageBand);
  const [content, setContent] = useState<MobileContent | null>(null), [state, setState] = useState<Replay | null>(null);
  const [phase, setPhase] = useState<Phase>('loading'), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [audioReady, setAudioReady] = useState(false), [audioError, setAudioError] = useState('');
  const [screenReaderEnabled, setScreenReaderEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [sync, setSync] = useState<'saved' | 'syncing' | 'pending' | 'synced'>('saved');
  const [result, setResult] = useState<Result | null>(null), [visible, setVisible] = useState(false);
  const runtime = useRef<SessionRuntime | null>(null), live = useRef(true), locking = useRef(false), queued = useRef(0), pausing = useRef(false);
  const lifecycle = useRef(new TrialLifecycle()).current;
  const authorization = useRef<ContinuationClock | null>(null), expired = useRef(false);
  const [authorizationNotice, setAuthorizationNotice] = useState(''), [offlineReady,setOfflineReady]=useState(false);
  const checkIn = useRef<PracticeCheckIn | null>(null), phaseRef = useRef<Phase>('loading'); phaseRef.current = phase;
  const windowCopy = session.continuation_grant?.body.version === 2 ? practiceWindowCopy(plan.locale, session.continuation_grant.body.recordUntil) : null;
  const audio = useAudioPlayer(null, { updateInterval: 250 }), audioStatus = useAudioPlayerStatus(audio);
  const trial = state?.active?.trial ?? plan.trials[state?.nextIndex ?? 0], last = state?.results.at(-1);
  const correctionTrial = last ? plan.trials.find(item => item.id === last.trialId) : undefined;
  const copy = content?.pack.copy;
  const stopAudio = () => { try { audio.pause(); } catch { /* Player may already be disposed on unmount. */ } };
  const audioUnavailable = t('声音暂时不能播放。你仍可看文字并继续练习。', 'Audio could not play. You can read the instruction and continue.');
  async function playNarration() {
    if (!audioReady || !live.current) return;
    setAudioError('');
    try { await audio.seekTo(0); audio.play(); }
    catch { if (live.current) setAudioError(audioUnavailable); }
  }
  function expireAuthorization(code = 'SESSION_AUTHORIZATION_EXPIRED') {
    if (expired.current || !runtime.current || !live.current || runtime.current.state.ended) return;
    expired.current = true; authorization.current?.block(code); void persistCheckpoint(); lifecycle.retire(); setVisible(false); stopAudio(); setPhase('pause');
    setAuthorizationNotice(code === 'SESSION_REPLACED' ? t('家长已结束这台设备的练习。已有步骤会单独保存，不再推进课程。', 'A parent ended practice on this device. Existing steps will be saved separately without advancing the course.') : code === 'SESSION_CLOCK_CHANGED' ? t('设备时间发生变化，本次练习已停下。已保存的步骤会保留。', 'The device clock changed, so this practice has stopped. Saved steps are preserved.') : windowCopy?.closed ?? t('这次练习可以继续的时间已结束。已停下新题目，保存的步骤会继续尝试同步。', 'The continuation window has ended. New steps have stopped; saved steps will still try to sync.'));
    void (async () => {
      await runtime.current?.settle();
      if (!live.current || locking.current || !runtime.current) return;
      await end(runtime.current.state.nextIndex >= plan.trials.length ? 'completed' : 'time_limit');
    })();
  }
  function mayContinue() {
    if (!authorization.current) return true;
    try { if (authorization.current.remaining() > 0) return true; }
    catch (e) { expireAuthorization(e instanceof AuthorizationError ? e.code : 'SESSION_CLOCK_CHANGED'); return false; }
    expireAuthorization(); return false;
  }
  function offerCheckIn() {
    const current = runtime.current;
    if (!current || locking.current || expired.current || !checkIn.current || !authorization.current || current.state.ended || current.state.nextIndex >= plan.trials.length) return false;
    if (checkIn.current.pending) { setPhase('check-in'); return true; }
    try {
      if (!checkIn.current.request(authorization.current.elapsed(), phaseRef.current, !!current.state.active || !!lifecycle.active || queued.current > 0)) return false;
    } catch (e) { expireAuthorization(e instanceof AuthorizationError ? e.code : 'SESSION_CLOCK_CHANGED'); return true; }
    lifecycle.retire(); stopAudio(); setVisible(false); setPhase('check-in'); return true;
  }
  function continueAfterCheckIn() {
    if (locking.current || queued.current || AppState.currentState !== 'active' || !mayContinue()) return;
    const previous = checkIn.current?.continue(authorization.current!.elapsed());
    if (previous) { setStatus(''); setPhase(previous); }
  }
  useEffect(() => { if (phase === 'check-in' && windowCopy) AccessibilityInfo.announceForAccessibility(windowCopy.title); }, [phase]);
  async function accessFailure(e: unknown) {
    if (!live.current || !unavailable(e)) return;
    locking.current = true; lifecycle.retire(); setVisible(false); setLocked(true); stopAudio(); setPhase('pause');
    setOfflineReady(false);
    setError(t('授权或内容状态已变化，这次练习已暂停。请回到家庭空间。', 'Access or content has changed. Practice is paused. Please return to your family space.'));
    const forgotten=client.forgetChildAccess();
    void forgotten.catch(()=>undefined);
    // Drain first: an in-flight local write must not recreate access after cleanup.
    await runtime.current?.stopAndDrain();
    try {
      if (e instanceof MobileRequestError && ['CONSENT_REVOKED', 'NOT_FOUND'].includes(e.code)) await removeChildJournals(familyId, session.child_id);
      else await dropOfflineSession(session.id, true);
      await forgotten;
    } catch { if(live.current)setError(t('练习已停止，本机资料清理尚未完成。请联网重新打开后处理。','Practice has stopped. Local cleanup is pending; reopen online to retry.')); }
  }
  const checkpointing = useRef(false);
  async function persistCheckpoint() {
    if(checkpointing.current || !authorization.current || !runtime.current || !live.current)return;
    checkpointing.current=true;
    try { await checkpointOffline(session.id,authorization.current.checkpoint()); }
    catch { if(live.current){locking.current=true;lifecycle.retire();setVisible(false);setLocked(true);stopAudio();setPhase('pause');setError(t('本机恢复信息暂时无法保存，已停下练习。已有记录会保留。','Recovery information could not be saved. Practice has stopped; existing records are preserved.'));} }
    finally {checkpointing.current=false;}
  }
  async function synchronize() {
    if (!runtime.current || locking.current || !live.current) return;
    setSync('syncing');
    try { const confirmed = await runtime.current.sync(); if (live.current) { setSync('synced'); if (confirmed) setResult(confirmed); } }
    catch (e) { if (live.current) { setSync('pending'); await accessFailure(e); } }
  }
  async function act(actions: Action[], next?: Phase | ((after: Replay) => Phase), observedAt?: number) {
    const current = runtime.current; if (!current || locking.current || !live.current) return null;
    const revision = lifecycle.revision;
    queued.current++; setBusy(true);
    try {
      const after = await current.record(actions, observedAt);
      if (live.current) { setSync('saved'); if (next && !locking.current && lifecycle.isCurrent(revision)) setPhase(typeof next === 'function' ? next(after) : next); void synchronize(); }
      return after;
    } catch (e) {
      if (e instanceof AuthorizationError) { expireAuthorization(e.code); return null; }
      if (live.current) { locking.current = true; lifecycle.retire(); setVisible(false); setLocked(true); stopAudio(); setPhase('pause'); setError(t('本机记录暂时无法保存，已停止练习。重新打开后可以恢复已保存部分。', 'Local saving is unavailable. Practice stopped. Reopen to recover previously saved steps.')); }
      return null;
    } finally { queued.current--; if (live.current) setBusy(queued.current > 0); }
  }
  function pause(reason: Extract<Action, { type: 'interrupt' }>['reason'] = 'pause', message = '') {
    stopAudio(); if (locking.current || pausing.current || !runtime.current || runtime.current.state.ended) return;
    if (checkIn.current?.pending) { setPhase('check-in'); return; }
    lifecycle.retire(); setVisible(false); setPhase('pause'); setStatus(message);
    if (!runtime.current.state.active && !queued.current) return;
    pausing.current = true;
    void act([{ type: 'interrupt', reason }], 'pause').finally(() => { pausing.current = false; });
  }
  function submit() {
    const current = runtime.current, window = lifecycle.active; if (!current || !window || !lifecycle.isActive(window)) return;
    lifecycle.retire(); setVisible(false); setPhase('settling');
    void act([{ type: 'submit' }], after => {
      const next = phaseAfterTrial(plan, window.trial, window.priorInvalidations, after);
      if (next === 'pause') setStatus(after.invalidations.length > window.priorInvalidations ? t('显示、计时或操作有变化。这一步没有计为错误，准备好后可以重来。', 'Display, timing or input changed. This step was excluded. Try again when ready.') : t('先歇一下，再一起看清规则。今天停在这里也可以。', 'Let’s pause and review the rule. You can also stop for today.'));
      return next;
    });
  }
  function next() {
    const current = runtime.current; if (!current || locking.current || queued.current || AppState.currentState !== 'active') return;
    if (screenReaderEnabled === null) { setStatus(t('正在确认辅助操作设置，请稍等。', 'Checking accessibility settings. One moment.')); return; }
    if ((plan.environment?.input === 'assistive') !== screenReaderEnabled) { pause('input_changed', t('读屏设置改变了。这一步未计分。切回原操作方式可重试，也可以重新选练习。', 'Screen reader settings changed. This step was not scored. Return to the original input mode to retry, or choose another practice.')); return; }
    lifecycle.retire();
    if (current.state.ended) { setPhase('summary'); return; }
    if (!mayContinue() || offerCheckIn()) return;
    stopAudio(); setStatus('');
    if (current.state.nextIndex >= plan.trials.length) { void end('completed'); return; }
    if (current.state.activeMs >= session.budget_ms) { void end('time_limit'); return; }
    if (remainingInterval(plan.trials[current.state.nextIndex], current.events, current.now()) > 0) { setPhase('gap'); return; }
    setVisible(false); setPhase('arming');
  }
  async function end(reason: 'completed' | 'child_stopped' | 'time_limit') {
    stopAudio(); lifecycle.retire(); setVisible(false);
    if (runtime.current?.state.ended) { setPhase('summary'); return; }
    setPhase('settling');
    await act([{ type: 'interrupt', reason: 'pause' }, { type: 'end', reason }], 'summary');
  }
  useEffect(() => {
    let active = true;
    const changed = (enabled: boolean) => {
      if (!active) return;
      setScreenReaderEnabled(enabled);
      if ((plan.environment?.input === 'assistive') !== enabled && ['arming', 'active'].includes(phaseRef.current)) pause('input_changed', t('读屏设置改变了。这一步未计分。切回原操作方式可重试，也可以重新选练习。', 'Screen reader settings changed. This step was not scored. Return to the original input mode to retry, or choose another practice.'));
    };
    void AccessibilityInfo.isScreenReaderEnabled().then(changed).catch(() => { if (active) setScreenReaderEnabled(null); });
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', changed);
    return () => { active = false; subscription.remove(); };
  }, [session.id]);
  useEffect(() => {
    live.current = true; const abort = new AbortController(); let unsubscribe: (() => void) | undefined;
    void setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false, playsInSilentMode: false, interruptionMode: 'doNotMix' }).catch(() => undefined);
    void (async () => {
      let preparationStage = 'local-storage';
      try {
        const generation=await offlineGeneration(),deviceId=await client.deviceId();
        let proof:AuthorizationProof|undefined,loaded:MobileContent;
        if(offline){
          preparationStage = 'offline-authorization';
          const saved=await readOfflineSession();
          if(!saved || saved.capsule.session.id!==session.id || saved.capsule.familyId!==familyId)throw new Error('OFFLINE_PREPARATION_CHANGED');
          const verified=await verifyOfflineSession(saved,deviceId,Platform.OS as 'ios'|'android',saved.events,nativeVerifier);
          authorization.current=verified.clock;
          loaded=await prepareContent(plan,client,abort.signal,verified.capsule.content);
        } else {
          preparationStage = 'online-authorization';
          authorization.current=await prepareAuthorization(session,deviceId,path=>client.request(path),nativeVerifier,value=>{proof=value});
          if(!live.current)return;
          preparationStage = 'content';
          loaded=await prepareContent(plan,client,abort.signal);
        }
        if(!live.current)return;
        preparationStage = 'event-journal';
        const current = new SessionRuntime(session, { now: () => performance.now(), uuid: randomUUID, authorize: actions => authorization.current?.assert(actions), journal: journalFor(familyId, session.child_id, session.id, () => authorization.current?.checkpoint() ?? {highest:Date.now(),fault:null}), send: events => client.request(`/sessions/${session.id}/events`, 'POST', { events }), finalize: lastSeq => client.request(`/sessions/${session.id}/finalize`, 'POST', { lastSeq }) });
        await current.initialize(); if (!live.current) { current.stop(); return; }
        let savedForOffline=offline;
        if(!offline && proof?.status.canContinue && authorization.current && !current.state.ended){
          try{
            authorization.current.assert([{type:'present',trialId:plan.trials[0].id}]);
            const capsule=makeOfflineCapsule(familyId,deviceId,session,proof,loaded.proof);
            await saveOfflineSession(capsule,generation,authorization.current.checkpoint(),current.events);savedForOffline=true;
          }catch(failure){
            if(failure instanceof OfflinePreparationChanged){current.stop();throw failure;}
            await dropOfflineSession(session.id);
            if(live.current)setStatus(t('本次未保存离线恢复资料，请保持联网。操作记录仍会保存。','Offline recovery was not prepared. Stay connected; your practice events will still be saved.'));
          }
        }
        if(!live.current){current.stop();return;}
        if(await offlineGeneration()!==generation){current.stop();throw new OfflinePreparationChanged();}
        if(!live.current){current.stop();return;}
        if (authorization.current?.grant.body.version === 2) checkIn.current = new PracticeCheckIn(authorization.current.grant.body.windowPolicy);
        runtime.current = current; setOfflineReady(savedForOffline); setContent(loaded); setState(current.state);
        unsubscribe = current.subscribe(() => { if (live.current) { setState(current.state); setResult(current.result); } });
        setPhase(current.state.ended ? 'summary' : AppState.currentState !== 'active' || current.events.length ? 'pause' : 'intro');
        if (loaded.pack.audio) {
          try {
            const uri = loaded.assets[loaded.pack.audio.assetId];
            if (!uri) throw new Error('Verified narration is unavailable');
            audio.replace({ uri });
            setAudioReady(true);
          } catch {
            // Optional narration must not lock a valid, text-accessible practice.
            setAudioReady(false);
            setAudioError(audioUnavailable);
          }
        }
        if (current.state.ended || mayContinue()) { if (current.events.length) void synchronize(); }
      } catch (failure) {
        // Stage and error code are safe for diagnostics; never log family data,
        // server response bodies, signed URLs, or credential-bearing messages.
        if (live.current) console.error('PRACTICE_PREPARATION_FAILED', preparationStage,
          failure instanceof Error ? failure.name : 'UnknownError',
          typeof failure === 'object' && failure !== null && 'code' in failure && typeof failure.code === 'string' ? failure.code : 'UNKNOWN');
        if(unavailable(failure)){await accessFailure(failure);return;}
        if(live.current && !isNetworkFailure(failure))await dropOfflineSession(session.id).catch(()=>undefined);
        if (live.current) { locking.current = true; setLocked(true); setPhase('pause'); setError(t('练习材料或加密记录尚未准备好。请回到家庭空间后重试。', 'Practice materials or encrypted storage are not ready. Return to your family space and retry.')); }
      }
    })();
    const appState = AppState.addEventListener('change', value => { if (value !== 'active') {stopAudio();const active = !!lifecycle.active || !!runtime.current?.state.active;if (shouldPauseForBackground(phaseRef.current, active)) pause('background', backgroundPauseCopy(plan.locale, active));void persistCheckpoint();} else { if (runtime.current) mayContinue(); void synchronize(); void checkContent(); } });
    const back = BackHandler.addEventListener('hardwareBackPress', () => { pause(); return true; });
    let checking = false;
    async function checkContent() {
      if (!plan.content || checking || locking.current || AppState.currentState !== 'active') return;
      checking = true;
      try {
        const status = await client.request<SessionStatus>(`/sessions/${session.id}/status`);
        if(!live.current)return;
        if (!status.canContinue) {
          // Stop immediately, even if persisting the tombstone later fails.
          expireAuthorization(status.historyOnly ? 'SESSION_REPLACED' : undefined);
          setOfflineReady(false);
          await dropOfflineSession(session.id,true);
        }
      } catch (e) { await accessFailure(e); } finally { checking = false; }
    }
    const timer = setInterval(() => { void persistCheckpoint(); void checkContent(); if (runtime.current?.state.ended) void synchronize(); }, 30000);
    const expiryTimer = setInterval(() => { if (runtime.current && AppState.currentState === 'active' && mayContinue()) offerCheckIn(); }, 1000);
    return () => { live.current = false; lifecycle.retire(); abort.abort(); unsubscribe?.(); stopAudio(); runtime.current?.stop(); appState.remove(); back.remove(); clearInterval(timer); clearInterval(expiryTimer); };
  }, [session.id]);
  useEffect(() => {
    if (phase !== 'arming' || !trial || !content) return;
    let frame = 0, cancelled = false; const revision = lifecycle.revision;
    frame = requestAnimationFrame(first => {
      frame = requestAnimationFrame(second => {
        if (cancelled || !lifecycle.isCurrent(revision) || AppState.currentState !== 'active') { if (!cancelled && lifecycle.isCurrent(revision)) setPhase('pause'); return; }
        if (!mayContinue() || offerCheckIn()) return;
        const delta = second - first, failed = delta <= 0 || (trial.windowMs > 0 && plan.environment?.input !== 'assistive' && delta > TIMING.maxFrameGapMs);
        // JS-backed native animation frames approximate presentation; no physical-display claim.
        if (delta <= 0) { setStatus(t('画面还没准备好，请稍后继续。', 'The display is not ready. Please try again.')); setPhase('pause'); return; }
        const current = runtime.current; if (!current || locking.current) return;
        const onset = current.now();
        if (failed) { lifecycle.retire(); setVisible(false); setPhase('pause'); setStatus(t('画面刚才停顿了，这一步不会算成漏答。', 'The display paused. This step will not count as a missed response.')); }
        else { lifecycle.begin(trial, onset, current.state); setVisible(true); setPhase('active'); }
        // Opening the response window does not await storage. Inputs are queued
        // after presentation with their observed times; only saved events are published.
        void act([{ type: 'present', trialId: trial.id, presentation: { assetsReady: true, frameDeltaMs: delta, method: 'native-frame' } }, ...(failed ? [{ type: 'interrupt' as const, reason: 'render_failure' as const }] : [])], undefined, onset);
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [phase, trial?.id, content]);
  useEffect(() => {
    const active = lifecycle.active;
    if (phase !== 'active' || !active || !runtime.current) return;
    const elapsed = runtime.current.now() - active.onset;
    const trialTimer = active.trial.windowMs ? setTimeout(() => { if (lifecycle.isActive(active)) { if (AppState.currentState === 'active') submit(); else pause('background', backgroundPauseCopy(plan.locale, true)); } }, Math.max(0, active.trial.windowMs - elapsed) + 5) : undefined;
    const budgetTimer = setTimeout(() => { if (lifecycle.isActive(active)) { if (AppState.currentState === 'active') void end('time_limit'); else pause('background', backgroundPauseCopy(plan.locale, true)); } }, Math.max(0, session.budget_ms - active.priorActiveMs - elapsed));
    let frame = 0, previous = performance.now();
    const observe = (at: number) => { if (!lifecycle.isActive(active)) return; const gap = at - previous; previous = at; if (gap > TIMING.maxFrameGapMs) pause('render_failure', t('画面刚才停顿了，这一步不会算成漏答。', 'The display paused. This step will not count as a missed response.')); else frame = requestAnimationFrame(observe); };
    if (active.trial.windowMs > 0 && plan.environment?.input !== 'assistive') frame = requestAnimationFrame(observe);
    return () => { clearTimeout(trialTimer); clearTimeout(budgetTimer); cancelAnimationFrame(frame); };
  }, [phase]);
  useEffect(() => { if (phase !== 'gap') return; const revision = lifecycle.revision; const timer = setTimeout(() => { if (lifecycle.isCurrent(revision)) next(); }, TIMING.intervalMs); return () => clearTimeout(timer); }, [phase, state?.nextIndex]);
  const choose = (index: number) => { const at = runtime.current?.now(); if (at !== undefined && AppState.currentState === 'active' && screenReaderEnabled !== null && (plan.environment?.input === 'assistive') === screenReaderEnabled && lifecycle.acceptsInput(at)) void act([{ type: 'choose', index, input: plan.environment?.input === 'assistive' ? 'assistive' : 'touch' }], undefined, at); };
  const imageFailed = () => pause('asset_failure', t('图片暂时无法显示，这一步没有计分。', 'The picture could not load. This step was not scored.'));
  const formal = state ? metrics(state.results) : null, done = state?.results.filter(r => !r.practice).length ?? 0, total = plan.trials.filter(r => !r.practice).length;
  const formalTrials = formal?.trials ?? 0, assistedTrials = formal?.assisted ?? 0;
  return <Page title={copy?.title ?? t('正在准备…', 'Getting ready…')} subtitle={teen ? 'FOCUS STUDIO' : t('每次一小步。你可以随时停下来。', 'One small step. You can stop at any time.')}>
    <View style={s.row}>{phase !== 'summary' && phase !== 'loading' && <Button quiet title={t('休息一下', 'Take a break')} disabled={locked} onPress={() => pause()} />}<Text accessibilityLiveRegion="polite" style={s.muted}>{busy ? t('正在记录', 'Recording') : sync === 'pending' ? t('本机已保存 · 等待同步', 'Saved here · Pending sync') : sync === 'syncing' ? t('正在同步', 'Syncing') : sync === 'synced' ? t('已同步', 'Synced') : t('本机保存', 'Saved here')}</Text></View><Notice>{error}</Notice><Notice>{authorizationNotice}</Notice>{offline && <Text style={s.muted}>{t('从本机恢复 · 新记录先保存在此设备，联网后再确认。','Restored on this device · New records are saved here first and confirmed when connected.')}</Text>}
    {phase === 'intro' && windowCopy && <Text style={s.muted}>{windowCopy.intro}</Text>}
    {phase === 'intro' && plan.environment?.input === 'assistive' && <Notice>{t('这是读屏操作的无单题倒计时练习。完成的步骤会单独保留，暂不推进基础课程或自动调难度。', 'This screen reader practice has no per-step countdown. Completed steps are kept separately; they do not advance the foundation course or automatically change difficulty yet.')}</Notice>}
    {phase === 'check-in' && windowCopy && <View style={s.card}><Text accessibilityRole="header" style={s.heading}>{windowCopy.title}</Text><Text style={s.body}>{windowCopy.body}</Text><Button title={windowCopy.stop} disabled={busy || locked} onPress={() => void end('child_stopped')} /><Button quiet title={windowCopy.proceed} disabled={busy || locked} onPress={continueAfterCheckIn} /></View>}
    {phase === 'loading' && <ActivityIndicator color={colors.accent} />}
    {phase === 'settling' && <View style={[s.center, { minHeight: 220 }]}><Text accessibilityLiveRegion="polite" style={s.muted}>{t('这一步结束了，稍等一下。', 'This step is finished. One moment.')}</Text></View>}
    {phase === 'intro' && session.continuation_grant && <Text style={s.muted}>{offlineReady ? t('这份练习的恢复资料已保存在此设备，有效期内可恢复。家长停止采集的通知，要联网后才能收到。', 'Recovery information for this practice is saved on this device and is valid within its continuation window. A parent’s request to stop collection is received when you reconnect.') : t('本次练习可以暂时断网继续；重新打开仍需联网确认。', 'This practice can briefly continue without a connection; reopening needs an online check.')}</Text>}{phase === 'intro' && copy && <View style={s.card}><Text style={s.heading}>{copy.skill}</Text><Text style={s.body}>{copy.rule}</Text>{content && <RuleExamples task={plan.task} locale={plan.locale} teen={teen} assets={content.assets} />}<View style={p.strategy}><Text style={s.body}>{copy.strategy}</Text></View>{content?.pack.audio && audioReady && <Button quiet title={audioStatus.playing ? t('停止播放', 'Stop audio') : content.pack.audio?.copyKey === 'strategy' ? t('听一听小策略', 'Listen to a tip') : t('听一听规则', 'Listen to the rule')} onPress={() => { if (audioStatus.playing) stopAudio(); else void playNarration(); }} />}{content?.pack.audio && <Notice>{audioError || (audioStatus.error ? audioUnavailable : '')}</Notice>}<Notice>{status}</Notice><Button title={t('我想试一试', 'I want to try')} disabled={busy} onPress={next} /><Button quiet title={t('今天先不做', 'Not today')} disabled={busy} onPress={() => void end('child_stopped')} /></View>}
    {(phase === 'arming' || phase === 'active') && trial && content && <View style={s.card}><Text style={s.label}>{trial.practice ? t('先熟悉规则', 'Try the rule first') : t('正式练习', 'Your practice')}</Text><Text style={s.body}>{copy?.rule}</Text><View style={{ opacity: visible ? 1 : 0 }} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
      {trial.task === 'search' && <View style={p.grid}>{trial.items.map((item, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${itemLabel(item, plan.locale, teen)} ${index + 1}`} accessibilityState={{ selected: state?.active?.selected.includes(index) ?? false, disabled: phase !== 'active' }} disabled={phase !== 'active'} onPress={() => choose(index)} style={[p.tile, state?.active?.selected.includes(index) && p.selected]}><Stimulus item={item} locale={plan.locale} teen={teen} assets={content.assets} size={58} onError={imageFailed} /></Pressable>)}</View>}
      {['stop', 'sustain'].includes(trial.task) && <View style={s.center}><Stimulus item={trial.items[0]} locale={plan.locale} teen={teen} assets={content.assets} size={144} onError={imageFailed} /></View>}
      {trial.task === 'memory' && <>{!state?.active?.recalled ? <View style={[p.grid, { justifyContent: 'center' }]}>{trial.sequence.map((item, index) => <View key={index} style={p.memoryItem}><Text style={s.muted}>{index + 1}</Text><Stimulus item={item} locale={plan.locale} teen={teen} assets={content.assets} size={58} onError={imageFailed} /></View>)}</View> : <><View style={p.slots}>{trial.sequence.map((_, index) => <View key={index} style={p.slot}>{state.active?.selected[index] === undefined ? <Text style={s.muted}>{index + 1}</Text> : <Stimulus item={trial.items[state.active.selected[index]]} locale={plan.locale} teen={teen} assets={content.assets} size={44} onError={imageFailed} />}</View>)}</View><View style={p.grid}>{trial.items.map((item, index) => <Pressable key={item} accessibilityRole="button" accessibilityLabel={itemLabel(item, plan.locale, teen)} disabled={busy || (state.active?.selected.length ?? 0) >= trial.sequence.length} onPress={() => choose(index)} style={p.tile}><Stimulus item={item} locale={plan.locale} teen={teen} assets={content.assets} size={64} onError={imageFailed} /></Pressable>)}</View></>}</>}
    </View>
    {trial.task === 'search' && <Button title={t('找好了', 'All found')} disabled={busy || phase !== 'active'} onPress={submit} />}
    {['stop', 'sustain'].includes(trial.task) && <><Pressable accessibilityRole="button" accessibilityLabel={trial.task === 'stop' ? t('请过桥', 'Go ahead') : t('看见星星', 'Star spotted')} disabled={phase !== 'active'} onPressIn={() => choose(0)} style={[s.button, phase !== 'active' && { opacity: 0.45 }]}><Text style={s.buttonText}>{trial.task === 'stop' ? t('请过桥', 'Go ahead') : t('看见星星', 'Star spotted')}</Text></Pressable><Text style={s.muted}>{state?.active?.selected.length ? t('已记录，等它离开。', 'Recorded. Let it pass.') : t('不是目标，就让它自己离开。', 'If it is not the target, let it pass.')}</Text></>}
    {trial.task === 'memory' && <>{!state?.active?.recalled ? <Button title={t('我记住了', 'I remember')} disabled={busy || phase !== 'active'} onPress={() => void act([{ type: 'encode_end' }])} /> : <><Button title={t('选好了', 'Done')} disabled={busy || state.active.selected.length !== trial.sequence.length} onPress={submit} /><Button quiet title={t('撤回上一步', 'Undo last choice')} disabled={busy || !state.active.selected.length} onPress={() => void act([{ type: 'undo' }])} /></>}</>}
    {trial.task !== 'stop' && trial.task !== 'sustain' && <Button quiet title={t('我需要帮助', 'I need help')} disabled={busy || phase !== 'active'} onPress={() => void act([{ type: 'help' }])} />}
    {(trial.task === 'stop' || trial.task === 'sustain') && <Button quiet title={t('我需要帮助', 'I need help')} disabled={busy || phase !== 'active'} onPress={() => pause('pause', t('先停下来看看规则，也可以请家长陪你。回来后会重新开始这一步。', 'Pause to review the rule, or ask a parent to help. This step will restart when you return.'))} />}
    </View>}
    {phase === 'feedback' && last && content && copy && <View style={s.card}><Text style={s.heading}>{last.correct ? t('这一步完成了', 'This step is complete') : t('一起再看一看', 'Let’s take another look')}</Text><Text style={s.body}>{feedbackGuidance(last, copy.strategy, plan.locale)}</Text>{!last.correct && correctionTrial?.task === 'search' && <Text style={s.body}>{t('目标的位置：', 'Target positions: ')}{searchTargetPositions(correctionTrial).join(' · ')}</Text>}{!last.correct && correctionTrial?.task === 'memory' && <><Text style={s.muted}>{t('刚才的顺序', 'The sequence you saw')}</Text><View style={p.grid}>{correctionTrial.sequence.map((item, index) => <View key={index} style={p.memoryItem}><Text style={s.muted}>{index + 1}</Text><Stimulus item={item} locale={plan.locale} teen={teen} assets={content.assets} size={58} /><Text style={s.muted}>{itemLabel(item, plan.locale)}</Text></View>)}</View></>}{last.practice && <Text style={s.muted}>{t('示范不会计入正式表现。', 'Practice examples do not count toward results.')}</Text>}<Button title={last.practice && (!last.correct || last.assisted) ? t('再试一次', 'Try again') : t('继续', 'Continue')} disabled={busy} onPress={next} /><Button quiet title={t('今天到这里', 'Stop for today')} disabled={busy} onPress={() => void end('child_stopped')} /></View>}
    {phase === 'gap' && <View style={[s.center, { minHeight: 220 }]}><Text style={s.muted}>{t('轻轻等一等', 'A short pause')}</Text></View>}
    {(phase === 'pause' || phase === 'rest') && <View style={s.card}><Text style={s.heading}>{t('休息一下', 'Take a break')}</Text><Text accessibilityLiveRegion="polite" style={s.body}>{status || t('看看远处，放松双手。准备好再继续。', 'Look into the distance and relax your hands. Continue when ready.')}</Text><Text style={s.body}>{copy?.rule}</Text>{!locked && <><Button title={t('我准备好了', 'I am ready')} disabled={busy} onPress={next} /><Button quiet title={t('今天到这里', 'Stop for today')} disabled={busy} onPress={() => void end('child_stopped')} /></>}<Button quiet title={t('回到家庭空间', 'Back to family space')} onPress={onExit} /></View>}
    {phase === 'summary' && <View style={s.card}><Text style={s.heading}>{t('今天先到这里', 'That is enough for today')}</Text><Text style={s.body}>{copy?.transfer}</Text><Text style={s.muted}>{done === 0 ? t('今天还没有完成正式步骤。示范不计入练习表现。', 'No formal step was completed today. Examples do not count toward results.') : plan.environment?.input === 'assistive' ? t(`用读屏方式完成 ${formalTrials + assistedTrials} 个正式步骤，单独保留，不计入普通触控表现。`, `You completed ${formalTrials + assistedTrials} formal screen reader steps. They are kept separately from standard touch results.`) : t(`完成 ${formalTrials} 个独立步骤，使用帮助 ${assistedTrials} 次。`, `${formalTrials} independent ${formalTrials === 1 ? 'step' : 'steps'} and ${assistedTrials} assisted ${assistedTrials === 1 ? 'step' : 'steps'}.`)}</Text><Text style={s.muted}>{result?.historyOnly ? t('换设备前的记录已单独保存，不计入课程或难度调整。', 'The previous-device record is saved separately and does not change the course or difficulty.') : result ? t('记录已由家庭服务确认。', 'Your records are confirmed by the family service.') : t('记录已保存在本机，等待服务确认。', 'Records are saved here and awaiting service confirmation.')}</Text>{!result && <Button quiet title={t('重新同步', 'Retry sync')} onPress={() => void synchronize()} />}{result && !result.historyOnly && formalTrials + assistedTrials > 0 && onExploreLife && <Button quiet title={t('愿意的话，看看生活小目标', 'If you like, explore an everyday goal')} onPress={onExploreLife} />}<Button title={t('回到家庭空间', 'Back to family space')} onPress={onExit} /></View>}
    {phase !== 'summary' && phase !== 'loading' && <Text style={s.muted}>{trial?.practice ? t('先理解，再开始', 'Understand the rule first') : `${done} / ${total}`}</Text>}
  </Page>;
}
const p = StyleSheet.create({ strategy: { backgroundColor: colors.soft, padding: 16, borderRadius: 16 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }, tile: { padding: 7, minWidth: 72, minHeight: 72, borderWidth: 2, borderColor: colors.line, borderRadius: 16, backgroundColor: '#FCFCF8', alignItems: 'center', justifyContent: 'center' }, selected: { borderColor: colors.accent, backgroundColor: colors.soft }, memoryItem: { gap: 8, alignItems: 'center', padding: 4 }, slots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 }, slot: { width: 52, height: 62, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' } });
