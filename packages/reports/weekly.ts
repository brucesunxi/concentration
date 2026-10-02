import { canonical } from '../content/index.ts';
import { practiceWindowPolicy, practiceWindowSchema } from '../session-runtime/practice-window.ts';
import type { PracticeWindowPolicy } from '../session-runtime/practice-window.ts';
import { metrics } from '../task-engine/index.ts';
import type { AgeBand, Environment, Locale, Metrics, Plan, TaskId, TrialResult } from '../task-engine/index.ts';
import type { Result } from '../contracts/models.ts';

type Timestamp = string | Date;
export interface ReportSession { id: string; plan: Plan; state: string; result: Result | null; created_at: Timestamp; completed_at: Timestamp | null; closed_reason?: string | null; window_policy?: PracticeWindowPolicy | null }
export interface ReportObservation { id: string; task: TaskId; context: string; prompts: number; child_choice: boolean; created_at: Timestamp }
export interface WeekRange { start: string; end: string; previousStart: string; previousEnd: string; today: string; inProgress: boolean; previous: string | null; next: string | null }
export interface WeekStats { sessions: number; completed: number; stoppedEarly: number; interruptions: number; excluded: number; metrics: Metrics }
export type ComparisonStatus = 'available' | 'week-in-progress' | 'missing-metadata' | 'interrupted-or-assisted' | 'insufficient-records' | 'incomplete-data' | 'assistive-mode-unvalidated';
export interface WeeklyGroup {
  key: string; task: TaskId; level: number; ageBand: AgeBand; locale: Locale;
  engineVersion: string; policyVersion: string | null; environment: Environment | null;
  content: Plan['content'] | null; windowPolicy: PracticeWindowPolicy | null; current: WeekStats; previous: WeekStats;
  comparison: { status: ComparisonStatus; changePoints: number | null };
}
export interface LifeStats { count: number; childChosen: number; minReminders: number | null; maxReminders: number | null }
export interface WeeklyReport {
  schemaVersion: 1; ruleVersion: 'weekly-descriptive-2'; childId: string; generatedAt: string; timezone: string; range: WeekRange;
  coverage: { finalized: number; completed: number; stoppedEarly: number; unfinalized: number; previousUnfinalized: number; unclassified: number; daysWithoutConfirmedPractice: number; historyOnly?: number; previousHistoryOnly?: number };
  days: { date: string; finalized: number; observations: number; future: boolean }[];
  strategies: { task: TaskId; sessions: number; independentSteps: number; assistedSteps: number; assistiveSteps: number }[];
  groups: WeeklyGroup[];
  life: { task: TaskId; context: string; current: LifeStats; previous: LifeStats }[];
}

const DAY = 86_400_000;
export function shiftDay(day: string, count: number) { return new Date(Date.parse(day + 'T00:00:00Z') + count * DAY).toISOString().slice(0, 10); }
function dayReader(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (at: Timestamp | number) => {
    const parts = formatter.formatToParts(new Date(at));
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
}
export function weekRange(timezone: string, now: number, requested?: string): WeekRange {
  const today = dayReader(timezone)(now);
  const weekday = new Date(today + 'T00:00:00Z').getUTCDay();
  const current = shiftDay(today, -((weekday + 6) % 7));
  const oldest = shiftDay(current, -51 * 7), start = requested ?? current;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start + 'T00:00:00Z')) || shiftDay(start, 0) !== start || new Date(start + 'T00:00:00Z').getUTCDay() !== 1 || start > current || start < oldest) throw new Error('INVALID_REPORT_WEEK');
  return { start, end: shiftDay(start, 6), previousStart: shiftDay(start, -7), previousEnd: shiftDay(start, -1), today, inProgress: start === current, previous: start > oldest ? shiftDay(start, -7) : null, next: start < current ? shiftDay(start, 7) : null };
}
/** Broad UTC bounds; exact inclusion uses family-local calendar dates below. */
export function reportQueryBounds(range: WeekRange) { return { from: shiftDay(range.previousStart, -2) + 'T00:00:00Z', until: shiftDay(range.end, 3) + 'T00:00:00Z' }; }
function summarize(records: ReportSession[]): WeekStats {
  const results = records.map(row => row.result!);
  return { sessions: results.length, completed: results.filter(r => r.completed).length, stoppedEarly: results.filter(r => !r.completed).length,
    interruptions: results.reduce((n, r) => n + r.interruptions, 0), excluded: results.reduce((n, r) => n + (r.invalidations?.length ?? r.interruptions), 0),
    metrics: metrics(results.flatMap(r => r.trials)) };
}
function sufficient(task: TaskId, stats: WeekStats) {
  if (stats.sessions < 2) return false;
  const m = stats.metrics;
  return task === 'search' ? m.trials >= 12 && m.targets >= 24 : task === 'memory' ? m.trials >= 20 : task === 'stop' ? m.targets >= 40 && m.distractors >= 20 : m.targets >= 20 && m.distractors >= 40;
}
function lifeStats(rows: ReportObservation[]): LifeStats {
  return { count: rows.length, childChosen: rows.filter(r => r.child_choice).length, minReminders: rows.length ? Math.min(...rows.map(r => r.prompts)) : null, maxReminders: rows.length ? Math.max(...rows.map(r => r.prompts)) : null };
}
/** Deterministic descriptive report, built only from server-confirmed results. */
export function buildWeeklyReport(childId: string, timezone: string, now: number, range: WeekRange, sessions: ReportSession[], observations: ReportObservation[]): WeeklyReport {
  const localDay = dayReader(timezone), generatedAt = new Date(now).toISOString();
  const within = (date: string, start: string, end: string) => date >= start && date <= end;
  const report: WeeklyReport = { schemaVersion: 1, ruleVersion: 'weekly-descriptive-2', childId, generatedAt, timezone, range,
    coverage: { finalized: 0, completed: 0, stoppedEarly: 0, unfinalized: 0, previousUnfinalized: 0, unclassified: 0, daysWithoutConfirmedPractice: 0 },
    days: Array.from({ length: 7 }, (_, index) => { const date = shiftDay(range.start, index); return { date, finalized: 0, observations: 0, future: date > range.today }; }), strategies: [], groups: [], life: [] };
  const groups = new Map<string, { plan: Plan; current: ReportSession[]; previous: ReportSession[] }>();
  const strategies = new Map<TaskId, { sessions: number; trials: TrialResult[]; assistiveSteps: number }>();
  for (const row of sessions) {
    const at = row.completed_at ?? row.created_at; if (new Date(at).getTime() > now) continue;
    const date = localDay(at), current = within(date, range.start, range.end), previous = within(date, range.previousStart, range.previousEnd);
    if (!current && !previous) continue;
    if (row.closed_reason === 'device_handover' || row.result?.historyOnly) { const field = current ? 'historyOnly' : 'previousHistoryOnly'; report.coverage[field] = (report.coverage[field] ?? 0) + 1; continue; }
    if (!row.result || !row.completed_at || !['completed', 'aborted'].includes(row.state)) { report.coverage[current ? 'unfinalized' : 'previousUnfinalized']++; continue; }
    const r = row.result, p = row.plan;
    if (current) {
      report.coverage.finalized++; report.coverage[r.completed ? 'completed' : 'stoppedEarly']++;
      report.days.find(day => day.date === date)!.finalized++;
    }
    if (row.window_policy && (!practiceWindowSchema.safeParse(row.window_policy).success || canonical(row.window_policy) !== canonical(practiceWindowPolicy(p.ageBand)))) { report.coverage.unclassified++; continue; }
    if (r.task !== p.task || r.condition !== p.condition || !Array.isArray(r.trials)) { report.coverage.unclassified++; continue; }
    if (current) { const strategy = strategies.get(p.task) ?? { sessions: 0, trials: [], assistiveSteps: 0 }; strategy.sessions++; if (p.environment?.input === 'assistive') strategy.assistiveSteps += r.trials.filter(trial => !trial.practice).length; else strategy.trials.push(...r.trials); strategies.set(p.task, strategy); }
    // Metadata is included explicitly; a legacy or inconsistent condition string cannot merge cohorts.
    const key = JSON.stringify([p.condition, p.task, p.version, p.policyVersion ?? null, p.level, p.ageBand, p.locale,
      p.environment?.platform ?? null, p.environment?.deviceClass ?? null, p.environment?.input ?? null, p.environment?.modality ?? null,
      p.content?.id ?? null, p.content?.version ?? null, p.content?.sha256 ?? null,
      row.window_policy?.version ?? null, row.window_policy?.maxElapsedMs ?? null, row.window_policy?.checkInAfterMs ?? null]);
    const group = groups.get(key) ?? { plan: p, current: [], previous: [] };
    group[current ? 'current' : 'previous'].push(row); groups.set(key, group);
  }
  for (const [task, value] of strategies) { const m = metrics(value.trials); report.strategies.push({ task, sessions: value.sessions, independentSteps: m.trials, assistedSteps: m.assisted, assistiveSteps: value.assistiveSteps }); }
  report.strategies.sort((a, b) => a.task.localeCompare(b.task));
  for (const [key, group] of groups) {
    const p = group.plan, current = summarize(group.current), previous = summarize(group.previous);
    let status: ComparisonStatus = 'available';
    if (p.version !== '2.0.0' || !p.environment || !p.content || !p.policyVersion) status = 'missing-metadata';
    else if (p.environment.input === 'assistive') status = 'assistive-mode-unvalidated';
    else if (range.inProgress) status = 'week-in-progress';
    else if (report.coverage.unfinalized || report.coverage.previousUnfinalized || report.coverage.unclassified || report.coverage.historyOnly || report.coverage.previousHistoryOnly) status = 'incomplete-data';
    // Do not skip interrupted/assisted attempts in order to select only clean successes.
    else if ([current, previous].some(s => s.stoppedEarly || s.metrics.assisted || s.interruptions || s.excluded)) status = 'interrupted-or-assisted';
    else if (!sufficient(p.task, current) || !sufficient(p.task, previous)) status = 'insufficient-records';
    const measure = (stats: WeekStats) => ['stop', 'sustain'].includes(p.task) ? stats.metrics.balancedAccuracy : stats.metrics.accuracy;
    const a = measure(current), b = measure(previous);
    report.groups.push({ key, task: p.task, level: p.level, ageBand: p.ageBand, locale: p.locale, engineVersion: p.version, policyVersion: p.policyVersion ?? null, environment: p.environment ?? null, content: p.content ?? null, windowPolicy: (group.current[0] ?? group.previous[0]).window_policy ?? null, current, previous,
      comparison: { status, changePoints: status === 'available' && a !== null && b !== null ? Math.round((a - b) * 1000) / 10 : null } });
  }
  report.groups.sort((a, b) => a.key.localeCompare(b.key));
  const life = new Map<string, { task: TaskId; context: string; current: ReportObservation[]; previous: ReportObservation[] }>();
  for (const row of observations) {
    if (new Date(row.created_at).getTime() > now) continue;
    const date = localDay(row.created_at), current = within(date, range.start, range.end), previous = within(date, range.previousStart, range.previousEnd);
    if (!current && !previous) continue;
    if (current) report.days.find(day => day.date === date)!.observations++;
    const key = JSON.stringify([row.task, row.context]);
    const group = life.get(key) ?? { task: row.task, context: row.context, current: [], previous: [] };
    group[current ? 'current' : 'previous'].push(row); life.set(key, group);
  }
  for (const group of life.values()) report.life.push({ task: group.task, context: group.context, current: lifeStats(group.current), previous: lifeStats(group.previous) });
  report.life.sort((a, b) => (a.task + a.context).localeCompare(b.task + b.context));
  report.coverage.daysWithoutConfirmedPractice = report.days.filter(day => !day.future && !day.finalized).length;
  return report;
}
