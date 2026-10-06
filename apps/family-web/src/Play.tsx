import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Pause, Play as PlayIcon, RotateCcw, Volume2, X, Leaf, CloudUpload, CloudOff, HelpCircle } from 'lucide-react';
import { replay, metrics, TIMING } from '../../../packages/task-engine/index.ts';
import type { EngineEvent, Action, Replay } from '../../../packages/task-engine/index.ts';
import { AssetPlayer } from '../../../packages/audio/player.ts';
import type { AudioState } from '../../../packages/audio/player.ts';
import { journal, readJournal, writeJournal, clearJournal, clearChildJournals, reconcile, highestContiguousSeq } from './journal.ts';
import { request, RequestError, inputForClick, deviceId } from './api.ts';
import type { Session, Result } from './api.ts';
import { taskContent, translate, isTeen, itemLabel } from './content.ts';
import { Stimulus, StimulusAssets } from './Stimulus.tsx';
import { RuleExamples } from './RuleExamples.tsx';
import { prepareContent } from './preflight.ts';
import type { PreparedContent,PlayableContent } from './preflight.ts';
import { appendObservations } from '../../../packages/session-runtime/observations.ts';
import { TrialLifecycle } from '../../../packages/session-runtime/trial-lifecycle.ts';
import { phaseAfterTrial } from '../../../packages/session-runtime/index.ts';
import { prepareAuthorization } from '../../../packages/session-runtime/prepare-authorization.ts';
import type { AuthorizationProof, SessionStatus } from '../../../packages/session-runtime/prepare-authorization.ts';
import { makeOfflineCapsule, verifyOfflineSession, OfflinePreparationChanged } from '../../../packages/session-runtime/offline-session.ts';
import { shellReady, acquirePracticeLock } from './offline-shell.ts';
import { AuthorizationError } from '../../../packages/session-runtime/authorization.ts';
import type { ContinuationClock } from '../../../packages/session-runtime/authorization.ts';
import { PracticeCheckIn, practiceWindowCopy } from '../../../packages/session-runtime/practice-window.ts';
import type { PracticePhase } from '../../../packages/session-runtime/practice-window.ts';

export interface StaffPreviewPort {
  prepare(signal:AbortSignal):Promise<PlayableContent>;
  check():Promise<void>;
  canContinue():boolean;
  save(events:EngineEvent[]):Promise<void>;
  finish(events:EngineEvent[]):Promise<void>;
}
type Phase = PracticePhase;
export function Play({ session, familyId, offline=false, preview, onExit, onExploreLife }: { session: Session; familyId:string; offline?:boolean; preview?:StaffPreviewPort; onExit: () => void; onExploreLife?: () => void }) {
  const plan = session.plan, modern = plan.version === '2.0.0', t = translate(plan.locale), teen = isTeen(plan.ageBand);
  const [prepared, setPrepared] = useState<PlayableContent | null>(null), preparedRef = useRef<PreparedContent | null>(null);
  const previewContent=useRef<PlayableContent|null>(null),[previewRecorded,setPreviewRecorded]=useState(false);
  const [legacyAssets, setLegacyAssets] = useState<Record<string, string>>({});
  const content = prepared?.pack.copy ?? taskContent(plan.task, plan.locale, plan.ageBand);
  const [events, setEvents] = useState<EngineEvent[]>([]), eventsRef = useRef<EngineEvent[]>([]);
  const [phase, setPhase] = useState<Phase>('loading'), [busy, setBusy] = useState(false), queued = useRef(0);
  const [error, setError] = useState(''), [statusMessage, setStatusMessage] = useState(''), [syncState, setSyncState] = useState('saved'), [result, setResult] = useState<Result | null>(null);
  const [locked, setLocked] = useState(false), lockedRef = useRef(false), interruptionQueued = useRef(false);
  const purgeOnLock = useRef(false);
  const [audioState, setAudioState] = useState<AudioState>('idle');
  const audio = useRef<AssetPlayer | null>(null);
  const origin = useRef(performance.now()), offset = useRef(0), acked = useRef(0), alive = useRef(true);
  const syncQueue = useRef<Promise<void>>(Promise.resolve()), recordQueue = useRef<Promise<unknown>>(Promise.resolve());
  const lifecycle = useRef(new TrialLifecycle()).current;
  const authorization = useRef<ContinuationClock | null>(null), expired = useRef(false), initialized = useRef(false);
  const [authorizationNotice, setAuthorizationNotice] = useState('');
  const checkIn = useRef<PracticeCheckIn | null>(null), phaseRef = useRef<Phase>('loading'); phaseRef.current = phase;
  const windowCopy = session.continuation_grant?.body.version === 2 ? practiceWindowCopy(plan.locale, session.continuation_grant.body.recordUntil) : null;
  const checkInHeading = useRef<HTMLHeadingElement>(null);
  const taskHeading = useRef<HTMLHeadingElement>(null), firstMemoryOption = useRef<HTMLButtonElement>(null);
  const [offlineReady,setOfflineReady]=useState(false), generation=useRef(-1), checkpointing=useRef(false);
  const state = replay(plan, events, session.budget_ms), trial = state.active?.trial ?? plan.trials[state.nextIndex];
  const last = state.results.at(-1), summary = metrics(state.results);
  const now = () => offset.current + performance.now() - origin.current;
  const hasAudio = modern ? !!prepared?.pack.audio : plan.locale === 'zh-CN' && !teen && ['search', 'stop', 'memory'].includes(plan.task);
  const audioId = plan.task === 'stop' ? 'stop-strategy' : `${plan.task}-rule`;
  async function saveCheckpoint(){
    if(!initialized.current||!authorization.current||!alive.current||checkpointing.current)return;
    checkpointing.current=true;
    try{await journal().checkpoint(session.id,authorization.current.checkpoint());}
    catch{if(alive.current){lockedRef.current=true;lifecycle.retire();audio.current?.stop();setLocked(true);setPhase('pause');setError(t('恢复资料暂时无法保存，已停下练习。已有记录会保留。','Recovery information could not be saved. Practice has stopped; existing records are preserved.'));}}
    finally{checkpointing.current=false;}
  }

  async function handleUnavailable(e: unknown) {
    if(preview){if(!alive.current)return;lockedRef.current=true;lifecycle.retire();audio.current?.stop();setLocked(true);setPhase(replay(plan,eventsRef.current).ended?'summary':'pause');setError(t('试玩身份、版本或连接已失效。请返回工作台重新准备；未核对的试玩不作为完成记录。','Preview access, version or connection is unavailable. Return to the studio; unconfirmed observations do not count as a completed preview.'));return;}
    if (!alive.current || !(e instanceof RequestError) || !['CONSENT_REVOKED', 'NOT_FOUND', 'UNAUTHENTICATED', 'EVENT_CONFLICT', 'CONTENT_RECALLED', 'CONTENT_NOT_FOUND', 'RELEASE_EXPIRED_OR_FUTURE', 'SESSION_DEVICE_MISMATCH', 'SESSION_UPLOAD_EXPIRED', 'MARKET_SCOPE_CHANGED'].includes(e.code)) return;
    lockedRef.current = true; lifecycle.retire(); setLocked(true); audio.current?.stop(); setPhase('pause');
    setOfflineReady(false);
    try{await journal().close(session.id);if (['CONSENT_REVOKED', 'NOT_FOUND'].includes(e.code)) { purgeOnLock.current = true; await clearChildJournals(session.child_id); }}catch{if(alive.current)setError(t('练习已暂停，本机访问清理尚未完成。请保持联网后重试。','Practice is paused. Local access cleanup is pending; reconnect and retry.'));return;}
    if (!alive.current) return;
    setError(t('授权、内容或记录状态已变化。已暂停，请回到家庭空间处理。', 'Access, content or saved records have changed. Please return to your family space.')); setPhase('pause');
  }
  function expireAuthorization(code = 'SESSION_AUTHORIZATION_EXPIRED') {
    if (expired.current || !initialized.current || !alive.current || replay(plan, eventsRef.current).ended) return;
    expired.current = true; authorization.current?.block(code); void saveCheckpoint();setOfflineReady(false);void journal().close(session.id).catch(()=>undefined);lifecycle.retire(); audio.current?.stop(); setPhase('pause');
    setAuthorizationNotice(code === 'SESSION_REPLACED' ? t('家长已结束这台设备的练习。已有步骤会单独保存，不再推进课程。', 'A parent ended practice on this device. Existing steps will be saved separately without advancing the course.') : code === 'SESSION_CLOCK_CHANGED' ? t('设备时间发生变化，本次练习已停下。已保存的步骤会保留。', 'The device clock changed, so this practice has stopped. Saved steps are preserved.') : windowCopy?.closed ?? t('这次练习可以继续的时间已结束。已停下新题目，保存的步骤会继续尝试同步。', 'The continuation window has ended. New steps have stopped; saved steps will still try to sync.'));
    void (async () => {
      await recordQueue.current;
      if (!alive.current || lockedRef.current) return;
      const saved = replay(plan, eventsRef.current, session.budget_ms);
      await end(saved.nextIndex >= plan.trials.length ? 'completed' : 'time_limit');
    })();
  }
  function mayContinue() {
    if(preview&&!preview.canContinue()){void handleUnavailable(new Error('Preview expired'));return false;}
    if (!authorization.current) return true;
    try { if (authorization.current.remaining() > 0) return true; }
    catch (e) { expireAuthorization(e instanceof AuthorizationError ? e.code : 'SESSION_CLOCK_CHANGED'); return false; }
    expireAuthorization(); return false;
  }

  function offerCheckIn() {
    if (!initialized.current || preview || lockedRef.current || expired.current || !checkIn.current || !authorization.current) return false;
    const saved = replay(plan, eventsRef.current, session.budget_ms);
    if (saved.ended || saved.nextIndex >= plan.trials.length) return false;
    if (checkIn.current.pending) { setPhase('check-in'); return true; }
    try {
      if (!checkIn.current.request(authorization.current.elapsed(), phaseRef.current, !!saved.active || !!lifecycle.active || queued.current > 0)) return false;
    } catch (e) { expireAuthorization(e instanceof AuthorizationError ? e.code : 'SESSION_CLOCK_CHANGED'); return true; }
    lifecycle.retire(); audio.current?.stop(); setPhase('check-in'); return true;
  }
  function continueAfterCheckIn() {
    if (lockedRef.current || queued.current || document.hidden || !mayContinue()) return;
    const previous = checkIn.current?.continue(authorization.current!.elapsed());
    if (previous) { setStatusMessage(''); setPhase(previous); }
  }
  useEffect(() => { if (phase === 'check-in') checkInHeading.current?.focus(); }, [phase]);

  function flush() {
    syncQueue.current = syncQueue.current.then(async () => {
      if (!alive.current || lockedRef.current) return;
      const snapshot = [...eventsRef.current]; if (!snapshot.length) return;
      if(preview){if(!replay(plan,snapshot).ended){setSyncState('saved');return;}setSyncState('syncing');try{await preview.finish(snapshot);if(alive.current){setPreviewRecorded(true);setSyncState('synced');setError('');}}catch(e){if(alive.current){setSyncState('pending');setError(t('试玩记录尚未核对，请保持页面打开后重试。','Preview observations are not confirmed. Keep this page open and retry.'));}}return;}
      setSyncState('syncing');
      try {
        while (acked.current < snapshot.length) {
          const batch = snapshot.slice(acked.current, acked.current + 100);
          const receipt = await request<{ highestContiguousSeq: number }>(`/sessions/${session.id}/events`, 'POST', { events: batch });
          if (!Number.isInteger(receipt.highestContiguousSeq) || receipt.highestContiguousSeq <= acked.current || receipt.highestContiguousSeq > snapshot.length) throw new Error('Invalid synchronization receipt');
          acked.current = receipt.highestContiguousSeq;
        }
        if (replay(plan, snapshot).ended) {
          const confirmed = await request<Result>(`/sessions/${session.id}/finalize`, 'POST', { lastSeq: snapshot.length });
          await clearJournal(session.id); if (alive.current) setResult(confirmed);
        }
        if (alive.current) setSyncState('synced');
      } catch (e) {
        if (!alive.current) return;
        setSyncState('pending');
        await handleUnavailable(e);
      }
    });
    return syncQueue.current;
  }
  function record(actions: Action[], next?: Phase | ((state: Replay) => Phase), capturedAt = now()): Promise<Replay | null> {
    if(preview&&!mayContinue())return Promise.resolve(null);
    try { authorization.current?.assert(actions); }
    catch (e) { expireAuthorization(e instanceof AuthorizationError ? e.code : 'SESSION_CLOCK_CHANGED'); return Promise.resolve(null); }
    const revision = lifecycle.revision; queued.current++; setBusy(true);
    const operation = recordQueue.current.then(async () => {
      if (lockedRef.current || !alive.current) return null;
      const { events: updated, state: after } = appendObservations(plan, eventsRef.current, actions, capturedAt, () => crypto.randomUUID(), session.budget_ms);
      if(preview)await preview.save(updated);else await writeJournal(session.id,session.child_id,familyId,updated,generation.current,authorization.current?.checkpoint());
      if (lockedRef.current) { if (purgeOnLock.current) await clearChildJournals(session.child_id); return null; }
      if (!alive.current) return null;
      eventsRef.current = updated; setEvents(updated); setSyncState('saved');
      if (next && lifecycle.isCurrent(revision)) setPhase(typeof next === 'function' ? next(after) : next);
      void flush(); return after;
    }).catch(e => {
      if (alive.current) { lifecycle.retire(); audio.current?.stop(); setError(t('本机记录暂时无法保存，已停止练习。重新打开后可以恢复已保存部分。', 'Local saving is unavailable. Practice stopped. Reopen to recover previously saved steps.')); setPhase('pause'); lockedRef.current = true; setLocked(true); }
      return null;
    }).finally(() => { queued.current--; if (alive.current) setBusy(queued.current > 0); });
    recordQueue.current = operation; return operation;
  }
  function interrupt(reason: Extract<Action, { type: 'interrupt' }>['reason'], message = '') {
    if (interruptionQueued.current || lockedRef.current) return;
    const current = replay(plan, eventsRef.current); if (current.ended) return;
    if (checkIn.current?.pending) { audio.current?.stop(); setPhase('check-in'); return; }
    lifecycle.retire(); audio.current?.stop(); setStatusMessage(message); setPhase('pause');
    if (!current.active && !queued.current) return;
    interruptionQueued.current = true;
    void record([{ type: 'interrupt', reason }], 'pause').finally(() => { interruptionQueued.current = false; });
  }
  function submit() {
    const window = lifecycle.active; if (!window || !lifecycle.isActive(window)) return;
    lifecycle.retire(); setPhase('settling');
    void record([{ type: 'submit' }], after => {
      if (after.invalidations.length > window.priorInvalidations) {
        setStatusMessage(t('这一步的显示、计时或操作方式有变化，已排除这条结果。准备好后可以重来。', 'Display, timing or input changed during this step. The result was excluded. You can try again when ready.')); return 'pause';
      }
      const next = phaseAfterTrial(plan, window.trial, window.priorInvalidations, after);
      if (next === 'pause') setStatusMessage(t('先歇一下，再一起看清规则。也可以今天就到这里。', 'Let’s pause and look at the rule together. You can also stop for today.'));
      return next;
    });
  }
  useEffect(() => {
    alive.current = true; audio.current = new AssetPlayer(setAudioState);
    const controller = new AbortController();let release:(()=>void)|undefined;
    void (async () => {
      try {
        if(preview){const loaded=await preview.prepare(controller.signal);if(!alive.current){loaded.dispose();return;}previewContent.current=loaded;setPrepared(loaded);initialized.current=true;setPhase(document.hidden?'pause':'intro');return;}
        release=await acquirePracticeLock();if(!alive.current){release();return;}
        generation.current=await journal().generation();let proof:AuthorizationProof|undefined;
        if(offline){
          const saved=await journal().resume();
          if(!saved||saved.capsule.session.id!==session.id||saved.capsule.familyId!==familyId||saved.generation!==generation.current)throw new OfflinePreparationChanged();
          const verified=await verifyOfflineSession(saved,deviceId(),'web',saved.events);
          authorization.current=verified.clock;
          const loaded=await prepareContent(plan,controller.signal,verified.capsule.content);
          if(!alive.current){loaded.dispose();return;}preparedRef.current=loaded;setPrepared(loaded);
        }else authorization.current = await prepareAuthorization(session, deviceId(), request,undefined,value=>{proof=value;});
        if (!alive.current) return;
        if (modern && !offline) {
          const loaded = await prepareContent(plan, controller.signal);
          if (!alive.current) { loaded.dispose(); return; }
          preparedRef.current = loaded; setPrepared(loaded);
        } else if(!modern) {
          const { prepareLegacyArtwork } = await import('./legacy-artwork.ts');
          const assets = await prepareLegacyArtwork(controller.signal);
          if (!alive.current) return;
          setLegacyAssets(assets);
        }
        if (authorization.current?.grant.body.version === 2) checkIn.current = new PracticeCheckIn(authorization.current.grant.body.windowPolicy);
        const local = await readJournal(session.id,session.child_id,familyId);
        let merged = reconcile(session.events ?? [], local); if (!alive.current) return;
        const previous = replay(plan, merged, session.budget_ms);
        if (previous.active) merged = [...merged, { id: crypto.randomUUID(), seq: merged.length + 1, at: merged.at(-1)?.at ?? 0, type: 'interrupt', reason: 'reload' }];
        await writeJournal(session.id,session.child_id,familyId,merged,generation.current,authorization.current?.checkpoint()); if (!alive.current) return;
        let canRestore=offline, withinWindow=false;
        try { withinWindow=(authorization.current?.remaining() ?? 0)>0; } catch { /* Finish initialization so closure can preserve the saved attempt. */ }
        if(withinWindow && !offline && proof?.status.canContinue && authorization.current && preparedRef.current?.cacheReady && !previous.ended && await shellReady()){
          if(!alive.current)return;
          authorization.current.assert([{type:'present',trialId:plan.trials[0].id}]);
          await journal().prepare(makeOfflineCapsule(familyId,deviceId(),session,proof,preparedRef.current.proof),generation.current,authorization.current.checkpoint(),merged);canRestore=true;
        }
        if(await journal().generation()!==generation.current)throw new OfflinePreparationChanged();
        if(!alive.current)return;setOfflineReady(canRestore);
        eventsRef.current = merged; offset.current = merged.at(-1)?.at ?? 0; origin.current = performance.now(); acked.current = highestContiguousSeq(session.events ?? []);
        initialized.current = true;
        setEvents(merged); setPhase(previous.ended ? 'summary' : document.hidden || merged.length ? 'pause' : 'intro');
        if (previous.ended || mayContinue()) { if (merged.length) void flush(); }
      } catch (e) {
        if(alive.current){await handleUnavailable(e);if(preview)return;setError(e instanceof Error && e.message==='PRACTICE_OPEN_ELSEWHERE'?t('这份练习已在另一个标签页打开。请先关闭那里的练习，再回来继续。','Practice is open in another tab. Close it there before continuing here.'):t('练习材料或浏览器恢复功能尚未准备好，已暂停。请联网返回家庭空间后重试。','Practice materials or browser recovery are not ready. Reconnect and return to your family space.'));setPhase('pause');lockedRef.current=true;setLocked(true);}
      }
    })();
    const online = () => { void flush(); };
    const hidden = () => { if (document.hidden) { audio.current?.stop(); interrupt('background');void saveCheckpoint(); } else if (initialized.current) mayContinue(); };
    const checkpointTimer=window.setInterval(()=>void saveCheckpoint(),30000);
    const expiryTimer = window.setInterval(() => { if (initialized.current && !document.hidden && mayContinue()) offerCheckIn(); }, 1000);
    window.addEventListener('online', online); document.addEventListener('visibilitychange', hidden);
    return () => { alive.current = false; initialized.current = false; clearInterval(expiryTimer);clearInterval(checkpointTimer);lifecycle.retire(); controller.abort(); audio.current?.stop(); preparedRef.current?.dispose();previewContent.current?.dispose();void recordQueue.current.finally(()=>release?.()); window.removeEventListener('online', online); document.removeEventListener('visibilitychange', hidden); };
  }, [session.id]);

  useEffect(() => {
    if (!modern || !prepared || !plan.content || locked || result || previewRecorded) return;
    let cancelled = false, checking = false;
    const checkStatus = async () => {
      if (cancelled || checking || document.hidden || lockedRef.current) return;
      checking = true;
      try { if(preview){await preview.check();return;}const status = await request<SessionStatus>(`/sessions/${session.id}/status`); if (!status.canContinue) expireAuthorization(status.historyOnly ? 'SESSION_REPLACED' : undefined); }
      catch (e) { if (!cancelled) await handleUnavailable(e); }
      finally { checking = false; }
    };
    // Polling also covers long instruction/recall screens with no uploads.
    // Status checks include consent, device ownership and content recall before sync.
    const interval = window.setInterval(() => void checkStatus(), 30000);
    const visible = () => { if (!document.hidden) void checkStatus(); };
    window.addEventListener('online', visible); window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('online', visible); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [session.id, prepared, locked, result, previewRecorded]);

  useEffect(() => {
    if (phase !== 'arming' || !trial) return;
    let frame = 0, cancelled = false; const revision = lifecycle.revision;
    frame = requestAnimationFrame(first => {
      frame = requestAnimationFrame(second => {
        if (cancelled || !lifecycle.isCurrent(revision) || document.hidden) { if (!cancelled && lifecycle.isCurrent(revision)) setPhase('pause'); return; }
        if (!mayContinue() || offerCheckIn()) return;
        const presentation = { frameDeltaMs: second - first, assetsReady: !!preparedRef.current || !!previewContent.current, method: 'raf-pair' as const };
        const failed = modern && plan.environment?.input !== 'assistive' && presentation.frameDeltaMs > TIMING.maxFrameGapMs;
        if (presentation.frameDeltaMs <= 0) { setPhase('pause'); setStatusMessage(t('画面还没准备好，请稍后继续。', 'The display is not ready. Please try again.')); return; }
        const onset = now();
        if (failed) { lifecycle.retire(); setPhase('pause'); setStatusMessage(t('刚才画面有些停顿，这一步不计入结果。准备好可以重来。', 'The display paused briefly. This step will not count. Try again when ready.')); }
        else { lifecycle.begin(trial, onset, replay(plan, eventsRef.current, session.budget_ms)); setPhase('active'); }
        void record([{ type: 'present', trialId: trial.id, ...(modern ? { presentation } : {}) }, ...(failed ? [{ type: 'interrupt' as const, reason: 'render_failure' as const }] : [])], undefined, onset);
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [phase, trial?.id]);
  useEffect(() => {
    const active = lifecycle.active; if (phase !== 'active' || !active?.trial.windowMs) return;
    const remaining = active.trial.windowMs - (now() - active.onset);
    const timer = window.setTimeout(() => { if (lifecycle.isActive(active)) { if (document.hidden) interrupt('background'); else submit(); } }, Math.max(0, remaining) + 5);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    const active = lifecycle.active; if (!modern || plan.environment?.input === 'assistive' || phase !== 'active' || !active) return;
    let frame = 0, prior = performance.now();
    const observe = (at: number) => {
      if (!lifecycle.isActive(active)) return;
      const gap = at - prior; prior = at;
      if (gap > TIMING.maxFrameGapMs) interrupt(document.hidden ? 'background' : 'render_failure', t('画面刚才发生停顿，这一步不计为漏答。', 'The display paused. This step will not count as a missed response.'));
      else frame = requestAnimationFrame(observe);
    };
    frame = requestAnimationFrame(observe); return () => cancelAnimationFrame(frame);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'gap') return;
    const revision = lifecycle.revision;
    const timer = window.setTimeout(() => { if (lifecycle.isCurrent(revision)) next(); }, TIMING.intervalMs); return () => clearTimeout(timer);
  }, [phase, state.nextIndex]);
  useEffect(() => {
    const active = lifecycle.active; if (phase !== 'active' || !active || locked) return;
    const remaining = session.budget_ms - active.priorActiveMs - (now() - active.onset);
    const timer = window.setTimeout(() => { if (lifecycle.isActive(active)) { if (document.hidden) interrupt('background'); else void end('time_limit'); } }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [phase, locked]);
  useEffect(() => {
    if (plan.environment?.input !== 'assistive' || phase !== 'active' || !state.active) return;
    if (state.active.trial.task === 'memory' && state.active.recalled) firstMemoryOption.current?.focus();
    else taskHeading.current?.focus();
  }, [phase, state.nextIndex, state.active?.recalled]);
  function pause() { audio.current?.stop(); interrupt('pause'); }
  function next() {
    if (initialized.current && !mayContinue()) return;
    if (lockedRef.current || queued.current || document.hidden) return;
    if (offerCheckIn()) return;
    lifecycle.retire();
    audio.current?.stop(); setError(''); setStatusMessage('');
    const current = replay(plan, eventsRef.current, session.budget_ms);
    if (current.ended) { setPhase('summary'); return; }
    if (current.nextIndex >= plan.trials.length || current.activeMs >= session.budget_ms) void end(current.nextIndex >= plan.trials.length ? 'completed' : 'time_limit');
    else if (modern && plan.trials[current.nextIndex].windowMs && !plan.trials[current.nextIndex].practice && now() - (eventsRef.current.findLast(e => e.type === 'submit')?.at ?? -Infinity) < TIMING.intervalMs) setPhase('gap');
    else setPhase('arming');
  }
  async function end(reason: 'completed' | 'child_stopped' | 'time_limit') {
    audio.current?.stop(); lifecycle.retire(); const current = replay(plan, eventsRef.current);
    if (current.ended) { setPhase('summary'); return; }
    setPhase('settling');
    await record([{ type: 'interrupt', reason: 'pause' }, { type: 'end', reason }], 'summary');
  }
  function choose(index: number, input: 'pointer' | 'touch' | 'keyboard' | 'assistive') {
    const at = now(); if (document.hidden || !lifecycle.acceptsInput(at)) return;
    if (!modern && ['stop', 'sustain'].includes(plan.task)) {
      lifecycle.retire(); setPhase('settling');
      void record([{ type: 'choose', index, input }, { type: 'submit' }], 'feedback', at);
    } else void record([{ type: 'choose', index, input }], undefined, at);
  }
  const formalTotal = plan.trials.filter(x => !x.practice).length, formalDone = state.results.filter(x => !x.practice).length;
  return <StimulusAssets.Provider value={modern ? prepared?.urls ?? {} : legacyAssets}><div className={`play-shell ${teen ? 'teen' : ''}`}>
    <header className="play-header"><button className="quiet" onClick={pause} disabled={locked || phase === 'loading' || phase === 'summary'}><Pause size={18} />{t('休息一下', 'Take a break')}</button><span className="play-brand"><Leaf size={20} />{teen ? 'FOCUS STUDIO' : t('专注岛', 'Focus Island')}</span><span className="sync-label" role="status">{syncState === 'pending' ? <CloudOff size={17} /> : <CloudUpload size={17} />}{preview ? (previewRecorded?'试玩已核对':busy?'记录试玩操作':'审核试玩') : busy ? t('正在记录', 'Recording') : syncState === 'synced' ? t('已同步', 'Synced') : syncState === 'syncing' ? t('正在同步', 'Syncing') : syncState === 'pending' ? t('等待同步', 'Pending sync') : t('本机保存', 'Saved here')}</span></header>
    <main className={`practice-panel ${content.color}`}>
      <div className="eyebrow">{content.skill} · {phase === 'intro' || trial?.practice ? t('先试一试', 'Try it first') : t('正式练习', 'Your practice')}</div>
      {error && <div className="notice error" role="alert">{error}</div>}{authorizationNotice && <div className="notice" role="status">{authorizationNotice}</div>}
      {phase === 'intro' && windowCopy && <p className="subtle">{windowCopy.intro}</p>}
      {phase === 'intro' && plan.environment?.input === 'assistive' && <p className="notice">{t('这是读屏操作的无单题倒计时练习。正式步骤单独保留，暂不推进基础课程或自动调难度。', 'This screen reader practice has no per-step countdown. Formal steps are kept separately; they do not advance the foundation course or change difficulty yet.')}</p>}
      {phase === 'check-in' && windowCopy && <section className="intro-stage" aria-labelledby="check-in-title"><div className="feedback-icon"><Leaf size={32} /></div><h1 id="check-in-title" tabIndex={-1} ref={checkInHeading}>{windowCopy.title}</h1><p className="rule">{windowCopy.body}</p><button className="primary large" disabled={busy || locked} onClick={() => void end('child_stopped')}>{windowCopy.stop}</button><button className="quiet" disabled={busy || locked} onClick={continueAfterCheckIn}>{windowCopy.proceed}</button></section>}
      {phase === 'loading' && <p role="status">{t('正在准备你的练习…', 'Preparing your practice…')}</p>}
      {offline && offlineReady && !locked && !result && <p className="notice">{t('已从此浏览器恢复。操作先保存在这里，联网后再确认同步。','Restored in this browser. Steps are saved here and confirmed when you reconnect.')}</p>}{phase === 'intro' && session.continuation_grant && <p className="subtle">{offlineReady?t('已保存此浏览器的恢复资料，在原授权期限内可以断网重开。家长远端变更要联网后才能收到。','Recovery information is saved in this browser within the original authorization window. Parent changes arrive when you reconnect.'):t('本页可在原授权期限内短暂断网继续。页面和素材尚未全部准备好供离线重开，请保持联网。','This open page can briefly continue within its original authorization window. Offline reopening is not fully prepared; stay connected.')}</p>}{phase === 'intro' && <div className="intro-stage"><div className="intro-illustration"><Stimulus item={plan.task === 'sustain' ? 'star' : plan.task === 'memory' ? 'apple' : 'rabbit'} locale={plan.locale} teen={teen} /></div><h1>{content.title}</h1><p className="rule">{content.rule}</p><RuleExamples task={plan.task} locale={plan.locale} teen={teen} /><div className="strategy"><Leaf size={20} />{content.strategy}</div>{hasAudio && <button className="quiet" onClick={() => audioState === 'playing' ? audio.current?.stop() : void (prepared?.pack.audio ? audio.current?.playSource(prepared.urls[prepared.pack.audio.assetId]) : audio.current?.play(audioId))}><Volume2 size={18} />{audioState === 'playing' ? t('停止播放', 'Stop audio') : prepared?.pack.audio?.copyKey === 'strategy' || (!modern && plan.task === 'stop') ? t('听一听小策略', 'Listen to a tip') : t('听一听规则', 'Listen to the rule')}</button>}{audioState === 'failed' && <p role="status">{t('声音暂时无法播放，可以先看文字。', 'Audio is unavailable. You can read the instruction.')}</p>}<button className="primary large" onClick={next} disabled={busy}><PlayIcon size={19} />{t('我想试一试', 'I want to try')}</button><button className="text-button" onClick={() => void end('child_stopped')}>{t('今天先不做', 'Not today')}</button></div>}
      {phase === 'settling' && <div className="signal-gap" role="status"><p>{t('这一步结束了，稍等一下。', 'This step is finished. One moment.')}</p></div>}
      {(phase === 'active' || phase === 'arming') && trial && <div style={{ visibility: phase === 'active' ? 'visible' : 'hidden' }} aria-hidden={phase !== 'active'} inert={phase !== 'active'}>
        <h1 className="task-heading" ref={taskHeading} tabIndex={-1}>{trial.practice ? t('熟悉一下规则', 'Get to know the rule') : content.title}</h1>
        <p className="rule compact">{content.rule}</p>
        {trial.task === 'search' && <><div className={`search-grid cells-${trial.items.length}`}>{trial.items.map((item, i) => <button key={i} className={`stimulus-tile ${state.active?.selected.includes(i) ? 'selected' : ''}`} aria-label={`${itemLabel(item, plan.locale, teen)} ${i + 1}`} aria-pressed={state.active?.selected.includes(i) ?? false} disabled={phase !== 'active'} onClick={e => choose(i, plan.environment?.input === 'assistive' ? 'assistive' : inputForClick(e))}><Stimulus item={item} locale={plan.locale} teen={teen} />{state.active?.selected.includes(i) && <Check className="selection-check" size={18} />}</button>)}</div><button className="primary large" disabled={busy || phase !== 'active'} onClick={submit}>{t('找好了', 'All found')}<Check size={18} /></button></>}
        {(trial.task === 'stop' || trial.task === 'sustain') && <><div className="signal-stage"><div className="signal-orbit" /><Stimulus item={trial.items[0]} locale={plan.locale} teen={teen} /></div><button className="primary large response-button" disabled={phase !== 'active'} onClick={e => choose(0, plan.environment?.input === 'assistive' ? 'assistive' : inputForClick(e))}>{trial.task === 'sustain' ? t('看见星星', 'Star spotted') : t('请过桥', 'Go ahead')}<ArrowRight size={20} /></button><p className="subtle">{state.active?.selected.length ? t('已记录，等它离开。', 'Recorded. Let it pass.') : t('不是目标，就让它自己离开。', 'If it is not the target, let it pass.')}</p></>}
        {trial.task === 'memory' && <>{!state.active?.recalled ? <><div className="sequence-row">{trial.sequence.map((item, i) => <div className="sequence-card" key={i}><small>{i + 1}</small><Stimulus item={item} locale={plan.locale} /><span>{itemLabel(item, plan.locale)}</span></div>)}</div><button className="primary large" onClick={() => void record([{ type: 'encode_end' }])} disabled={busy || phase !== 'active'}>{t('记好了，收起来', 'Ready, hide them')}<ArrowRight size={18} /></button></> : <><div className="sequence-row answers">{trial.sequence.map((_, i) => <div key={i} className="answer-slot">{state.active?.selected[i] !== undefined ? <Stimulus item={trial.items[state.active.selected[i]]} locale={plan.locale} /> : <span>{i + 1}</span>}</div>)}</div><div className="memory-options">{trial.items.map((item, i) => <button key={item} ref={i === 0 ? firstMemoryOption : undefined} className="stimulus-tile" disabled={busy || (state.active?.selected.length ?? 0) >= trial.sequence.length} onClick={e => choose(i, plan.environment?.input === 'assistive' ? 'assistive' : inputForClick(e))}><Stimulus item={item} locale={plan.locale} /><span>{itemLabel(item, plan.locale)}</span></button>)}</div><div className="button-row"><button className="quiet" disabled={busy || !state.active?.selected.length} onClick={() => void record([{ type: 'undo' }])}><RotateCcw size={17} />{t('撤回一个', 'Undo one')}</button><button className="quiet" disabled={busy} onClick={() => void record([{ type: 'help' }])}><HelpCircle size={17} />{t('再看一次', 'Look again')}</button></div><button className="primary large" disabled={busy || state.active?.selected.length !== trial.sequence.length} onClick={submit}>{t('排好了', 'Sequence ready')}<Check size={18} /></button></>}</>}
      </div>}
      {phase === 'gap' && <div className="signal-gap" role="status"><span aria-hidden="true">·</span><p>{t('留意下一个', 'Watch for the next one')}</p></div>}
      {phase === 'rest' && <div className="intro-stage"><div className="feedback-icon"><Leaf size={32} /></div><h1>{t('这一小段完成了', 'That short block is complete')}</h1><p className="rule">{t('放松一下眼睛。准备好后再继续，也可以今天到这里。', 'Rest your eyes. Continue when ready, or stop for today.')}</p><button className="primary large" onClick={next} disabled={busy}>{state.nextIndex >= plan.trials.length ? t('完成这次练习', 'Finish this practice') : t('准备好，下一小段', 'Ready for the next block')}<ArrowRight size={18} /></button><button className="quiet" onClick={() => void end('child_stopped')} disabled={busy}>{t('今天到这里', 'That is enough for today')}</button></div>}
      {phase === 'feedback' && last && <div className="feedback-stage"><div className="feedback-icon">{last.correct ? <Check size={36} /> : <Leaf size={36} />}</div><h1>{last.correct ? t('这一步完成了', 'That step is done') : t('一起再看一看', 'Let’s take another look')}</h1><p className="rule">{last.correct ? content.strategy : plan.task === 'stop' || plan.task === 'sustain' ? last.falseAlarms ? t('刚才不是目标，下一次先看清，再决定。', 'That was not the target. Look first, then decide.') : t('刚才是目标，看见它时可以点一下。', 'That was the target. Tap when you see it.') : content.strategy}</p>{!last.correct && plan.task === 'memory' && <div className="sequence-row">{plan.trials.find(x => x.id === last.trialId)?.sequence.map((item, i) => <div className="sequence-card" key={i}><small>{i + 1}</small><Stimulus item={item} locale={plan.locale} /></div>)}</div>}{!last.correct && plan.task === 'search' && <p>{t('目标的位置：', 'Target positions: ')}{plan.trials.find(x => x.id === last.trialId)?.items.map((item, i) => item === 'rabbit' ? i + 1 : null).filter(Boolean).join(' · ')}</p>}<button className="primary large" disabled={busy} onClick={next}>{last.practice && (!last.correct || last.assisted) ? t('再试一次', 'Try again') : state.nextIndex >= plan.trials.length ? t('完成这次练习', 'Finish this practice') : !trial?.practice && last.practice ? t('我明白了，开始吧', 'I understand, let’s start') : t('下一小步', 'Next small step')}<ArrowRight size={18} /></button><button className="text-button" onClick={pause}>{t('我想休息', 'I want a break')}</button></div>}
      {phase === 'pause' && <div className="intro-stage"><div className="feedback-icon"><Pause size={32} /></div><h1>{t('休息，也很重要', 'A break matters too')}</h1><p className="rule">{statusMessage || t('不用赶。刚才没做完的一小步，回来后重新开始。', 'No rush. The interrupted step will start fresh when you return.')}</p><button className="primary large" onClick={next} disabled={busy || !!error}>{t('准备好了，继续', 'Ready to continue')}<PlayIcon size={18} /></button><button className="quiet" disabled={busy || locked} onClick={() => void end('child_stopped')}><X size={17} />{t('今天到这里', 'That is enough for today')}</button>{error && <button className="text-button" onClick={onExit}>{preview?'返回内容工作台':t('返回家庭空间', 'Return to family space')}</button>}</div>}
      {phase === 'summary' && <div className="summary-stage"><div className="feedback-icon"><Leaf size={36} /></div><h1>{t('把一个小策略，带回生活', 'Take one small strategy with you')}</h1><p className="rule">{plan.environment?.input === 'assistive' && summary.trials + summary.assisted > 0 ? t(`用读屏方式完成 ${summary.trials + summary.assisted} 个正式步骤，已单独保留。`, `You completed ${summary.trials + summary.assisted} formal screen reader steps, kept separately.`) : summary.trials ? t(`你完成了 ${summary.trials} 个独立小步骤。`, `You completed ${summary.trials} independent ${summary.trials === 1 ? 'step' : 'steps'}.`) : t('今天先熟悉了规则，还没有完成正式步骤。可以休息，也可以和家人一起再看规则。', 'You explored the rule today, with no formal step completed yet. Take a break, or revisit the rule together.')}</p><div className="transfer-card"><span className="eyebrow">{t('离开屏幕的小任务', 'A little off-screen activity')}</span><h2>{content.skill}</h2><p>{content.transfer}</p></div><p className="subtle" role="status">{preview ? (previewRecorded?t('试玩记录已核对，仅供内容审核，不进入家庭报告。','Preview confirmed for content review only; no family report was created.'):t('试玩只暂存在此页面，请核对成功后再返回工作台。','Preview observations stay in this page until confirmed.')) : result?.historyOnly ? t('换设备前的记录已单独保存，不计入课程或难度调整。', 'The previous-device record is saved separately and does not change the course or difficulty.') : result ? t('记录已由服务端核对，家长可以查看。', 'Your record has been checked and saved for your family.') : t('已保存在这台设备，等待同步确认。', 'Saved on this device, awaiting sync confirmation.')}</p>{!result && !previewRecorded && <button className="quiet" onClick={() => void flush()}>{preview?'重试核对试玩':t('重试同步', 'Retry sync')}</button>}{result && !result.historyOnly && summary.trials + summary.assisted > 0 && onExploreLife && <button className="quiet" onClick={onExploreLife}>{t('愿意的话，看看生活小目标','If you like, explore an everyday goal')}</button>}<button className="primary large" disabled={!!preview&&!previewRecorded} onClick={onExit}>{preview ? '返回内容工作台' : result ? t('完成，去休息', 'Done, time for a break') : t('先去休息，稍后同步', 'Take a break, sync later')}<ArrowRight size={18} /></button></div>}
      {phase !== 'summary' && phase !== 'loading' && <div className="practice-progress"><div className="progress-track"><span style={{ width: `${100 * formalDone / formalTotal}%` }} /></div><span>{trial?.practice ? t('示范不计入正式表现', 'Practice does not count toward your results') : `${formalDone} / ${formalTotal} · ${t('每次一小步', 'One small step at a time')}`}</span></div>}
    </main><footer className="play-footer"><Leaf size={15} />{t('不需要比快。你可以随时停下来。', 'No need to rush. You can stop at any time.')}</footer>
  </div></StimulusAssets.Provider>;
}
