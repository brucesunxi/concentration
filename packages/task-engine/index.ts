import { replay as replayLegacy, adapt as adaptLegacy } from './legacy-v1.ts';
import type { EngineEvent as LegacyEvent } from './legacy-v1.ts';
export type TaskId = 'search' | 'stop' | 'memory' | 'sustain';
export type AgeBand = '6-8' | '9-11' | '12-14' | '15-17';
export type Locale = 'zh-CN' | 'en';
export type Item = 'rabbit' | 'fox' | 'bear' | 'cat' | 'apple' | 'leaf' | 'flower' | 'berry' | 'star' | 'moon';
export const TASKS: TaskId[] = ['search', 'stop', 'memory', 'sustain'];
export const ENGINE_VERSION = '2.0.0';
export const POLICY_VERSION = 'conservative-2';
export const TIMING = Object.freeze({ intervalMs: 1000, maxFrameGapMs: 100, maxTimerLatenessMs: 250, minimumResponseMs: 100 });
export interface Environment { platform: 'web' | 'ios' | 'android'; deviceClass: 'desktop' | 'tablet' | 'phone'; input: 'pointer' | 'touch' | 'keyboard' | 'assistive'; modality: 'visual' }
export interface ContentReference { id: string; version: string; sha256: string }
export interface Presentation { frameDeltaMs: number; assetsReady: boolean; method: 'raf-pair' | 'native-frame' }
export const TEST_ENVIRONMENT: Environment = { platform: 'web', deviceClass: 'desktop', input: 'pointer', modality: 'visual' };
export const TEST_CONTENT: ContentReference = { id: 'test-fixture', version: '0.0.0-test', sha256: '0'.repeat(64) };
export const DAILY_LIMIT: Record<AgeBand, number> = { '6-8': 480_000, '9-11': 600_000, '12-14': 720_000, '15-17': 720_000 };

export interface Trial {
  id: string; task: TaskId; practice: boolean; block: number;
  items: Item[]; target: Item; sequence: Item[]; go: boolean; windowMs: number;
}
export interface Plan {
  id: string; task: TaskId; ageBand: AgeBand; locale: Locale; level: number;
  seed: string; version: string; condition: string; trials: Trial[];
  environment?: Environment; content?: ContentReference; policyVersion?: string;
}
export type Action =
  | { type: 'present'; trialId: string; presentation?: Presentation }
  | { type: 'choose'; index: number; input?: Environment['input'] }
  | { type: 'undo' }
  | { type: 'encode_end' }
  | { type: 'help' }
  | { type: 'submit' }
  | { type: 'interrupt'; reason: 'background' | 'pause' | 'asset_failure' | 'reload' | 'render_failure' | 'timer_late' | 'input_changed' }
  | { type: 'end'; reason: 'completed' | 'child_stopped' | 'time_limit' };
export type EngineEvent = Action & { id: string; seq: number; at: number };
export interface TrialResult {
  trialId: string; task: TaskId; block: number; practice: boolean; assisted: boolean;
  correct: boolean; hits: number; targets: number; falseAlarms: number; distractors: number;
  matched: number; length: number; durationMs: number; responseCount?: number; firstResponseMs?: number | null;
}
interface ActiveTrial { trial: Trial; onset: number; selected: number[]; recalled: boolean; assisted: boolean; responseCount: number; firstResponseMs: number | null; invalidReason: string | null }
export interface Invalidation { trialId: string; block: number; practice: boolean; reason: string }
export interface Replay {
  nextIndex: number; active: ActiveTrial | null; results: TrialResult[];
  interruptions: number; activeMs: number; ended: boolean; endReason: string | null; invalidations: Invalidation[]; errorStreak: number;
}
export class ProtocolError extends Error {
  code = 'INVALID_EVENT';
}
function requireThat(ok: unknown, message: string): asserts ok { if (!ok) throw new ProtocolError(message); }

export function randomFrom(seed: string) {
  let x = 2166136261;
  for (const char of seed) x = Math.imul(x ^ char.charCodeAt(0), 16777619);
  return () => {
    x += 0x6D2B79F5;
    let t = x; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function constrainedDeck(goCount: number, noCount: number, random: () => number): boolean[] {
  const source = [...Array<boolean>(goCount).fill(true), ...Array<boolean>(noCount).fill(false)];
  for (let attempt = 0; attempt < 10000; attempt++) {
    const deck = shuffle(source, random);
    if (deck.every((v, i) => i < 3 || !(v === deck[i - 1] && v === deck[i - 2] && v === deck[i - 3]))) return deck;
  }
  throw new Error('Unable to generate constrained deck');
}
export function createPlan(input: Pick<Plan, 'id' | 'task' | 'ageBand' | 'locale' | 'level' | 'seed'> & { environment: Environment; content: ContentReference }): Plan {
  requireThat(TASKS.includes(input.task) && Object.hasOwn(DAILY_LIMIT, input.ageBand), 'Unsupported task or age');
  requireThat(Number.isInteger(input.level) && input.level >= 1 && input.level <= 3, 'Invalid level');
  requireThat(['web', 'ios', 'android'].includes(input.environment.platform) && ['desktop', 'tablet', 'phone'].includes(input.environment.deviceClass) && ['pointer', 'touch', 'keyboard', 'assistive'].includes(input.environment.input) && input.environment.modality === 'visual', 'Unsupported environment');
  requireThat(input.environment.input !== 'assistive' || ['search', 'memory'].includes(input.task), 'Timed assistive protocol is not available');
  requireThat(/^[a-f0-9]{64}$/.test(input.content.sha256), 'Invalid content reference');
  const random = randomFrom(input.seed);
  const teen = ['12-14', '15-17'].includes(input.ageBand);
  const trials: Trial[] = [];
  function add(practice: boolean, block: number, i: number, go = true) {
    let items: Item[] = [], sequence: Item[] = [], target: Item = 'rabbit', windowMs = 0;
    if (input.task === 'search') {
      const count = practice ? 6 : Math.min(16, (teen ? 9 : 6) + (input.level - 1) * 3);
      const targets = practice ? 1 : 1 + Math.floor(random() * 2);
      items = shuffle([...Array<Item>(targets).fill('rabbit'), ...Array.from({ length: count - targets }, (_, j) => (['fox', 'bear', 'cat'] as Item[])[j % 3])], random);
    } else if (input.task === 'memory') {
      items = ['apple', 'leaf', 'flower', 'berry'];
      sequence = shuffle(items, random).slice(0, practice ? 2 : input.level + 1);
      if (practice && i === 1 && sequence.join(',') === trials[0]?.sequence.join(',')) sequence.reverse();
    } else {
      target = input.task === 'stop' ? 'rabbit' : 'star';
      const distractor = input.task === 'stop' ? (['fox', 'bear', 'cat'] as Item[])[practice ? 0 : Math.floor(random() * input.level)] : 'moon';
      items = [go ? target : distractor];
      windowMs = input.task === 'stop' ? 3600 : 3000;
    }
    trials.push({ id: `${input.id}:${practice ? 'p' : block}:${i}`, task: input.task, practice, block, items, target, sequence, go, windowMs });
  }
  if (input.task === 'stop' || input.task === 'sustain') [true, false, true, false].forEach((go, i) => add(true, -1, i, go));
  else for (let i = 0; i < 2; i++) add(true, -1, i);
  for (let block = 0; block < 2; block++) {
    if (input.task === 'stop' || input.task === 'sustain') {
      const targetCount = input.task === 'stop' ? 8 : input.level + 3;
      const otherCount = input.task === 'stop' ? 4 : 2 * targetCount;
      constrainedDeck(targetCount, otherCount, random).forEach((go, i) => add(false, block, i, go));
    } else for (let i = 0; i < 4; i++) add(false, block, i);
  }
  return { ...input, version: ENGINE_VERSION, policyVersion: POLICY_VERSION, condition: [ENGINE_VERSION, POLICY_VERSION, input.content.sha256, input.task, input.ageBand, input.locale, input.environment.modality, input.environment.platform, input.environment.deviceClass, input.environment.input, input.level].join(':'), trials };
}

export function scoreTrial(active: ActiveTrial, durationMs: number): TrialResult {
  const t = active.trial, chosen = active.selected;
  let hits = 0, targets = 0, falseAlarms = 0, distractors = 0, matched = 0, length = 0;
  if (t.task === 'search') {
    targets = t.items.filter(x => x === t.target).length; distractors = t.items.length - targets;
    hits = chosen.filter(i => t.items[i] === t.target).length;
    falseAlarms = chosen.filter(i => t.items[i] !== t.target).length;
  } else if (t.task === 'memory') {
    length = t.sequence.length; matched = t.sequence.filter((item, i) => item === t.items[chosen[i]]).length;
  } else {
    targets = t.go ? 1 : 0; distractors = t.go ? 0 : 1;
    hits = t.go && chosen.length > 0 ? 1 : 0;
    falseAlarms = !t.go && chosen.length > 0 ? 1 : 0;
  }
  const correct = t.task === 'memory' ? length === chosen.length && matched === length : hits === targets && falseAlarms === 0;
  return { trialId: t.id, task: t.task, block: t.block, practice: t.practice, assisted: active.assisted, correct, hits, targets, falseAlarms, distractors, matched, length, durationMs, responseCount: active.responseCount, firstResponseMs: active.firstResponseMs };
}

/** Replay consumes observations, never a client supplied correctness flag. */
export function replay(plan: Plan, events: EngineEvent[], budgetMs = Infinity): Replay {
  if (plan.version === '1.0.0') return { ...replayLegacy(plan, events as LegacyEvent[], budgetMs), invalidations: [], errorStreak: 0 } as Replay;
  requireThat(plan.version === ENGINE_VERSION && plan.environment && plan.content && plan.policyVersion === POLICY_VERSION, 'Unsupported or incomplete protocol version');
  const state: Replay = { nextIndex: 0, active: null, results: [], interruptions: 0, activeMs: 0, ended: false, endReason: null, invalidations: [], errorStreak: 0 };
  let previousSubmit: { at: number; trial: Trial } | null = null;
  let priorAt = 0;
  const ids = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    requireThat(event.seq === i + 1, 'Events must be contiguous');
    requireThat(!ids.has(event.id), 'Duplicate event identifier'); ids.add(event.id);
    requireThat(Number.isFinite(event.at) && event.at >= priorAt && event.at <= 86_400_000, 'Invalid monotonic time'); priorAt = event.at;
    requireThat(!state.ended, 'Session has already ended');
    if (event.type === 'present') {
      requireThat(state.activeMs < budgetMs, 'Daily active-time limit reached');
      requireThat(!state.active && plan.trials[state.nextIndex]?.id === event.trialId, 'Trial order mismatch');
      const trial = plan.trials[state.nextIndex];
      requireThat(event.presentation && Number.isFinite(event.presentation.frameDeltaMs) && event.presentation.frameDeltaMs > 0 && event.presentation.method === (plan.environment.platform === 'web' ? 'raf-pair' : 'native-frame'), 'Presentation evidence required');
      if (previousSubmit && trial.windowMs && !trial.practice && !previousSubmit.trial.practice && previousSubmit.trial.block === trial.block) requireThat(event.at - previousSubmit.at >= TIMING.intervalMs, 'Stimulus interval too short');
      state.active = { trial, onset: event.at, selected: [], recalled: trial.task !== 'memory', assisted: false, responseCount: 0, firstResponseMs: null, invalidReason: !event.presentation.assetsReady ? 'asset_failure' : trial.windowMs > 0 && plan.environment.input !== 'assistive' && event.presentation.frameDeltaMs > TIMING.maxFrameGapMs ? 'render_failure' : null };
      continue;
    }
    if (event.type === 'end') {
      requireThat(!state.active, 'Interrupt an active trial before ending');
      requireThat(event.reason !== 'completed' || state.nextIndex === plan.trials.length, 'Cannot complete unfinished plan');
      state.ended = true; state.endReason = event.reason; continue;
    }
    const active = state.active;
    requireThat(active, 'No active trial');
    const elapsed = event.at - active.onset;
    switch (event.type) {
      case 'choose': {
        requireThat(active.recalled, 'Memory material is still visible');
        requireThat(Number.isInteger(event.index) && event.index >= 0 && event.index < active.trial.items.length, 'Invalid target');
        requireThat(!active.trial.windowMs || elapsed <= active.trial.windowMs, 'Response after window');
        requireThat(event.input && ['pointer', 'touch', 'keyboard', 'assistive'].includes(event.input), 'Input method required');
        active.responseCount++;
        if (active.firstResponseMs === null) active.firstResponseMs = elapsed;
        if (event.input !== plan.environment.input) active.invalidReason = 'input_changed';
        if (active.trial.windowMs && elapsed < TIMING.minimumResponseMs) active.invalidReason = 'premature_input';
        if (active.trial.task === 'search') active.selected = active.selected.includes(event.index) ? active.selected.filter(x => x !== event.index) : [...active.selected, event.index];
        else if (active.trial.task === 'memory') { requireThat(active.selected.length < active.trial.sequence.length, 'Sequence full'); active.selected.push(event.index); }
        else active.selected = [event.index];
        break;
      }
      case 'undo': requireThat(active.trial.task === 'memory' && active.recalled, 'Undo unavailable'); active.selected.pop(); break;
      case 'encode_end': requireThat(active.trial.task === 'memory' && !active.recalled, 'Invalid memory phase'); active.recalled = true; break;
      case 'help': active.assisted = true; if (active.trial.task === 'memory') { active.recalled = false; active.selected = []; } break;
      case 'interrupt': state.activeMs += Math.min(elapsed, active.trial.windowMs || elapsed); state.interruptions++; state.invalidations.push({ trialId: active.trial.id, block: active.trial.block, practice: active.trial.practice, reason: event.reason }); state.active = null; break;
      case 'submit': {
        requireThat(active.recalled, 'Cannot submit visible memory material');
        requireThat(!active.trial.windowMs || elapsed >= active.trial.windowMs, 'Timed trial ended too early');
        if (active.trial.windowMs && elapsed > active.trial.windowMs + TIMING.maxTimerLatenessMs) active.invalidReason = 'timer_late';
        const duration = Math.min(elapsed, active.trial.windowMs || elapsed);
        state.activeMs += duration;
        previousSubmit = { at: event.at, trial: active.trial };
        if (active.invalidReason) {
          state.invalidations.push({ trialId: active.trial.id, block: active.trial.block, practice: active.trial.practice, reason: active.invalidReason });
        } else {
          const result = scoreTrial(active, duration); state.results.push(result);
          state.errorStreak = result.correct ? 0 : state.errorStreak + 1;
          if (!active.trial.practice || (result.correct && !result.assisted)) state.nextIndex++;
          else if (['search', 'memory'].includes(active.trial.task)) state.nextIndex = 0;
        }
        state.active = null; break;
      }
    }
  }
  return state;
}

export interface Metrics {
  trials: number; assisted: number; correct: number; targets: number; hits: number;
  distractors: number; falseAlarms: number; accuracy: number | null;
  hitRate: number | null; waitRate: number | null; balancedAccuracy: number | null;
}
export function metrics(results: TrialResult[]): Metrics {
  const formal = results.filter(x => !x.practice), independent = formal.filter(x => !x.assisted);
  const sum = (k: 'targets' | 'hits' | 'distractors' | 'falseAlarms') => independent.reduce((a, x) => a + x[k], 0);
  const targets = sum('targets'), hits = sum('hits'), distractors = sum('distractors'), falseAlarms = sum('falseAlarms');
  const hitRate = targets ? hits / targets : null, waitRate = distractors ? 1 - falseAlarms / distractors : null;
  const correct = independent.filter(x => x.correct).length;
  return { trials: independent.length, assisted: formal.length - independent.length, correct, targets, hits, distractors, falseAlarms,
    accuracy: independent.length ? correct / independent.length : null, hitRate, waitRate,
    balancedAccuracy: hitRate !== null && waitRate !== null ? (hitRate + waitRate) / 2 : null };
}
export function wilsonLower(k: number, n: number): number | null {
  if (!n) return null;
  const z = 1.281551566, p = k / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
}
export interface Evidence { condition: string; completedAt: string; results: TrialResult[]; invalidations?: Invalidation[] }
export function adapt(plan: Plan, history: Evidence[], nowMs: number): { level: number; reason: string } {
  if (plan.version === '1.0.0') return adaptLegacy(plan, history, nowMs);
  if (plan.environment?.input === 'assistive') return { level: plan.level, reason: 'HOLD_ASSISTIVE_MODE_UNVALIDATED' };
  const recent = history.filter(x => x.condition === plan.condition && nowMs - Date.parse(x.completedAt) <= 14 * 86400000 && Date.parse(x.completedAt) <= nowMs).slice(-3);
  const hold = (reason: string) => ({ level: plan.level, reason });
  const last = recent.at(-1);
  if (!last) return hold('HOLD_ASSISTANCE_OR_NO_DATA');
  if (recent.some(x => x.results.some(r => !r.practice && r.assisted) || x.invalidations?.some(r => !r.practice))) return hold('HOLD_RECENT_ASSISTANCE_OR_INTERRUPTION');
  const blocks = recent.flatMap(h => [...new Set(h.results.filter(x => !x.practice).map(x => x.block))].map(b => metrics(h.results.filter(x => x.block === b))));
  const success = (m: Metrics) => plan.task === 'stop' || plan.task === 'sustain' ? m.balancedAccuracy : m.accuracy;
  if (blocks.length >= 2 && blocks.slice(-2).every(m => m.trials > 0 && m.assisted === 0 && (success(m) ?? 1) < .6)) return { level: Math.max(1, plan.level - 1), reason: 'EASIER_TWO_LOW_BLOCKS' };
  const m = metrics(recent.flatMap(x => x.results));
  if (recent.length < 2) return hold('HOLD_MORE_SESSIONS');
  if (plan.task === 'search' && (m.trials < 12 || m.targets < 24)) return hold('HOLD_MORE_SEARCH');
  if (plan.task === 'memory' && m.trials < 20) return hold('HOLD_MORE_SEQUENCES');
  if (plan.task === 'stop' && (m.targets < 40 || m.distractors < 20)) return hold('HOLD_MORE_GO_NO_GO');
  if (plan.task === 'sustain' && (m.targets < 20 || m.distractors < 40)) return hold('HOLD_MORE_MONITORING');
  const pass = (k: number, n: number) => !!n && k / n >= .85 && (wilsonLower(k, n) ?? 0) >= .7;
  const qualifies = plan.task === 'memory' ? pass(m.correct, m.trials) : pass(m.hits, m.targets) && pass(m.distractors - m.falseAlarms, m.distractors) && m.falseAlarms / m.distractors <= .1;
  return qualifies ? { level: Math.min(3, plan.level + 1), reason: 'HARDER_SUFFICIENT_EVIDENCE' } : hold('HOLD_PRACTICE_STRATEGY');
}

export function courseUnit(completedSessions: number) {
  const count = Number.isFinite(completedSessions) ? Math.max(0, Math.floor(completedSessions)) : 0;
  const unit = Math.min(23, count), complete = count >= 24;
  return { week: Math.floor(unit / 3) + 1, unit, task: (['search', 'stop', 'memory', 'sustain'] as const)[Math.floor(unit / 3) % 4], complete, weekDone: complete ? 3 : count % 3 };
}
