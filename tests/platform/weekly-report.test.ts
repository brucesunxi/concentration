import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPlan, replay, metrics, TEST_CONTENT, TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import type { Plan, TaskId } from '../../packages/task-engine/index.ts';
import { buildWeeklyReport, weekRange, reportQueryBounds } from '../../packages/reports/weekly.ts';
import type { ReportSession, ReportObservation } from '../../packages/reports/weekly.ts';
import { weeklyPresentation } from '../../packages/reports/presentation.ts';
import { practiceWindowPolicy } from '../../packages/session-runtime/practice-window.ts';
import { completeEvents } from './fixtures.ts';

const now = Date.parse('2026-09-30T12:00:00Z');
function row(at: string, task: TaskId = 'memory', changes: Partial<Plan> = {}): ReportSession {
  const plan = createPlan({ id: randomUUID(), task, ageBand: '9-11', locale: 'en', level: 1, seed: 'weekly-fixture', environment: TEST_ENVIRONMENT, content: TEST_CONTENT, ...changes });
  const state = replay(plan, completeEvents(plan));
  return { id: plan.id, plan, state: 'completed', created_at: at, completed_at: at, result: { sessionId: plan.id, task, condition: plan.condition, completed: true, completedAt: at, trials: state.results, metrics: metrics(state.results), interruptions: 0, invalidations: [], activeMs: state.activeMs, decision: { level: 1, reason: 'TEST_ONLY' } } };
}
const comparable = () => [...Array.from({ length: 3 }, () => row('2026-09-22T12:00:00Z')), ...Array.from({ length: 3 }, () => row('2026-09-15T12:00:00Z'))];
const build = (sessions: ReportSession[], observations: ReportObservation[] = [], week = '2026-09-21', timezone = 'UTC', at = now) => buildWeeklyReport('synthetic-child', timezone, at, weekRange(timezone, at, week), sessions, observations);

test('week selection uses family calendar dates and rejects normalized invalid dates, non-Mondays and out-of-range requests', () => {
  const instant = Date.parse('2026-09-20T23:30:00Z');
  assert.equal(weekRange('Pacific/Kiritimati', instant).start, '2026-09-21');
  assert.equal(weekRange('America/Los_Angeles', instant).start, '2026-09-14');
  assert.equal(weekRange('Asia/Kolkata', instant).start, '2026-09-21');
  for (const date of ['2026-02-30', '2026-09-22', '2026-10-05', '2024-01-01', 'not-a-date']) assert.throws(() => weekRange('UTC', now, date), /INVALID_REPORT_WEEK/);
  assert.equal(weekRange('UTC', now, '2026-09-21').next, '2026-09-28');
  assert.equal(weekRange('UTC', now).next, null);
});

test('a DST repeat and a Sunday-to-Monday timezone boundary are counted by local date rather than fixed UTC hours', () => {
  const times = ['2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z'];
  const report = build(times.map(time => row(time)), [], '2026-10-26', 'America/Los_Angeles', Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(report.coverage.finalized, 2); assert.equal(report.days[6].finalized, 2);
  const boundary = row('2026-09-20T10:30:00Z');
  assert.equal(build([boundary], [], '2026-09-21', 'Pacific/Kiritimati').coverage.finalized, 1);
  assert.equal(build([boundary], [], '2026-09-21', 'America/Los_Angeles').coverage.finalized, 0);
  const bounds = reportQueryBounds(weekRange('Pacific/Kiritimati', now, '2026-09-21'));
  assert.ok(Date.parse(bounds.from) < Date.parse(String(boundary.completed_at)) && Date.parse(bounds.until) > Date.parse(String(boundary.completed_at)));
});

test('weekly metrics aggregate actual independent steps, exclude practice/help and never average session percentages', () => {
  const records = comparable();
  const changed = records[3].result!;
  changed.trials.filter(t => !t.practice).forEach(t => { t.correct = false; t.matched = 0; });
  // A stale precomputed percentage must not override the trial-level evidence.
  changed.metrics.accuracy = 1;
  const report = build(records), group = report.groups[0];
  assert.equal(group.current.metrics.trials, 24); assert.equal(group.previous.metrics.correct, 16);
  assert.equal(group.comparison.status, 'available'); assert.equal(group.comparison.changePoints, 33.3);
  assert.equal(report.strategies[0].independentSteps, 24);
  assert.equal(report.coverage.completed, 3);
});
test('screen reader steps remain separate and never produce a week-to-week performance difference', () => {
  const standard = row('2026-09-22T12:00:00Z', 'memory');
  const assistive = row('2026-09-22T13:00:00Z', 'memory', { environment: { platform: 'ios', deviceClass: 'phone', input: 'assistive', modality: 'visual' } });
  const report = build([standard, assistive]);
  assert.equal(report.groups.length, 2);
  assert.equal(report.groups.find(group => group.environment?.input === 'assistive')?.comparison.status, 'assistive-mode-unvalidated');
  assert.equal(report.groups.find(group => group.environment?.input === 'assistive')?.comparison.changePoints, null);
  assert.equal(report.strategies[0].independentSteps, 8);
  assert.equal(report.strategies[0].assistiveSteps, 8);
  const view = weeklyPresentation(report, 'en');
  assert.match(JSON.stringify(view), /Screen reader|screen reader/);
  assert.match(JSON.stringify(view), /kept separately/);
});

test('levels, input, device, language and content identity create separate groups even with a reused condition string', () => {
  const base = row('2026-09-22T12:00:00Z');
  const variants = [
    { level: 2 }, { locale: 'zh-CN' }, { ageBand: '12-14' },
    { environment: { ...TEST_ENVIRONMENT, input: 'keyboard' } },
    { environment: { ...TEST_ENVIRONMENT, platform: 'ios', input: 'touch', deviceClass: 'phone' } },
    { content: { ...TEST_CONTENT, sha256: '1'.repeat(64) } },
    { policyVersion: 'separate-policy' },
  ] as Partial<Plan>[];
  const records = [base, ...variants.map(change => { const next = structuredClone(base); next.id = randomUUID(); Object.assign(next.plan, change); return next; })];
  assert.equal(build(records).groups.length, records.length);
  assert.ok(build(records).groups.every(g => g.comparison.status === 'insufficient-records'));
});

test('partial weeks, sparse samples, missing metadata and assisted or stopped attempts cannot yield a difference', () => {
  assert.equal(build(comparable(), [], '2026-09-28').groups[0].comparison.status, 'week-in-progress');
  assert.equal(build([row('2026-09-22T12:00:00Z')]).groups[0].comparison.status, 'insufficient-records');
  for (const kind of ['help', 'interrupt', 'stopped', 'metadata'] as const) {
    const records = comparable(), r = records[0].result!;
    if (kind === 'help') r.trials.find(t => !t.practice)!.assisted = true;
    if (kind === 'interrupt') { r.interruptions = 1; r.invalidations = [{ reason: 'background', practice: false }]; }
    if (kind === 'stopped') { r.completed = false; records[0].state = 'aborted'; }
    if (kind === 'metadata') records.forEach(row => { row.plan.environment = undefined; });
    const report = build(records);
    assert.equal(report.groups[0].comparison.status, kind === 'metadata' ? 'missing-metadata' : 'interrupted-or-assisted');
    assert.equal(report.groups[0].comparison.changePoints, null);
    assert.equal(report.groups[0].current.sessions, 3);
  }
});

test('known missing results and inconsistent conditions suppress differences while future records remain outside the report', () => {
  const pending = row('2026-09-22T12:00:00Z'); pending.result = null; pending.completed_at = null; pending.state = 'active';
  const report = build([...comparable(), pending, row('2026-10-01T12:00:00Z')]);
  assert.equal(report.coverage.unfinalized, 1); assert.equal(report.coverage.finalized, 3);
  assert.equal(report.groups[0].comparison.status, 'incomplete-data');
  const broken = row('2026-09-15T12:00:00Z'); broken.result!.condition = 'mismatched';
  const inconsistent = build([...comparable(), broken]);
  assert.equal(inconsistent.coverage.unclassified, 1); assert.equal(inconsistent.groups[0].comparison.changePoints, null);
});

test('life observations remain separated by activity and task, preserving counts and ranges without an improvement claim', () => {
  const observation = (context: string, task: TaskId, prompts: number, date: string): ReportObservation => ({ id: randomUUID(), context, task, prompts, child_choice: prompts === 0, created_at: date });
  const records = [observation('packing', 'memory', 0, '2026-09-22T12:00Z'), observation('packing', 'memory', 4, '2026-09-23T12:00Z'), observation('reading', 'memory', 1, '2026-09-22T12:00Z'), observation('packing', 'search', 2, '2026-09-22T12:00Z'), observation('packing', 'memory', 7, '2026-09-15T12:00Z')];
  const report = build([], records), group = report.life.find(g => g.task === 'memory' && g.context === 'packing')!;
  assert.equal(report.life.length, 3); assert.deepEqual(group.current, { count: 2, childChosen: 1, minReminders: 0, maxReminders: 4 });
  assert.equal(group.previous.maxReminders, 7); assert.equal(report.days.reduce((n, day) => n + day.observations, 0), 4);
  for (const language of ['zh-CN', 'en'] as const) { const view = weeklyPresentation(report, language); assert.equal(view.sections.length, 3); assert.ok(!JSON.stringify(view).includes('undefined')); }
});

test('an empty current week distinguishes elapsed missing dates from future dates and contains no fabricated score', () => {
  const report = build([], [], '2026-09-28');
  assert.equal(report.coverage.daysWithoutConfirmedPractice, 3); assert.equal(report.days.filter(day => day.future).length, 4);
  assert.deepEqual(report.groups, []); assert.deepEqual(report.strategies, []); assert.deepEqual(report.life, []);
  const text = JSON.stringify(weeklyPresentation(report, 'en'));
  assert.ok(!text.includes('NaN')); assert.ok(!text.includes('0/0')); assert.ok(!text.includes('percentage points'));
});

test('a practice-only early stop is disclosed as having no completed formal steps', () => {
  const attempt = row('2026-09-22T12:00:00Z');
  attempt.state = 'aborted';
  attempt.result!.completed = false;
  attempt.result!.trials = attempt.result!.trials.filter(trial => trial.practice);
  attempt.result!.metrics = metrics(attempt.result!.trials);
  const report = build([attempt]);
  const zh = weeklyPresentation(report, 'zh-CN');
  const en = weeklyPresentation(report, 'en');
  assert.equal(report.coverage.completed, 0);
  assert.match(zh.sections[0].items[0].lines.join(' '), /尚无完成的正式步骤/);
  assert.match(en.sections[0].items[0].lines.join(' '), /no completed formal steps/);
  assert.match(en.sections[0].items[0].lines[0], /1 attempt; 0 valid independent steps/);
  assert.match(zh.days[1].label, /已确认练习记录 1 条/);
  assert.match(en.days[1].label, /1 confirmed practice record · 0 observations/);
});

test('previous-device records remain separate and suppress a misleading comparison in either week',()=>{
 for(const previous of [false,true]){
  const records=comparable(),archived=row(previous?'2026-09-15T13:00:00Z':'2026-09-22T13:00:00Z');
  archived.closed_reason='device_handover';archived.state='aborted';archived.result!.historyOnly=true;
  const report=build([...records,archived]);assert.equal(report.coverage[previous?'previousHistoryOnly':'historyOnly'],1);assert.equal(report.coverage.finalized,3);
  assert.equal(report.groups[0].current.sessions,3);assert.equal(report.groups[0].previous.sessions,3);assert.equal(report.groups[0].comparison.status,'incomplete-data');assert.equal(report.groups[0].comparison.changePoints,null);
  assert.match(weeklyPresentation(report,'en').missing,/previous-device|device records/);
 }
});


test('practice-window policies separate otherwise identical report conditions and unknown rules suppress comparison', () => {
  const records = comparable();
  records.slice(0, 3).forEach(row => { row.window_policy = practiceWindowPolicy(row.plan.ageBand); });
  const separate = build(records); assert.equal(separate.ruleVersion, 'weekly-descriptive-2');
  assert.equal(separate.groups.length, 2); assert.ok(separate.groups.every(g => g.comparison.changePoints === null));
  records.slice(3).forEach(row => { row.window_policy = practiceWindowPolicy(row.plan.ageBand); });
  const together = build(records); assert.equal(together.groups.length, 1); assert.equal(together.groups[0].comparison.status, 'available');
  assert.ok(JSON.stringify(weeklyPresentation(together, 'en')).includes('Practice window up to 25 minutes'));
  records[0].window_policy = { ...practiceWindowPolicy('9-11'), maxElapsedMs: 999999 };
  const unknown = build(records); assert.equal(unknown.coverage.unclassified, 1); assert.equal(unknown.groups[0].comparison.changePoints, null);
});
