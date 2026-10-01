import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionRuntime, phaseAfterSubmission, remainingInterval } from '../../packages/session-runtime/index.ts';
import { createPlan, replay, metrics, TEST_CONTENT } from '../../packages/task-engine/index.ts';
import type { TaskId, EngineEvent, Action } from '../../packages/task-engine/index.ts';
import type { Session, Result } from '../../packages/contracts/models.ts';
import { completeEvents } from './fixtures.ts';
import { appendObservations } from '../../packages/session-runtime/observations.ts';
import { TrialLifecycle } from '../../packages/session-runtime/trial-lifecycle.ts';

function harness(task: TaskId = 'search') {
  const plan = createPlan({ id: randomUUID(), task, ageBand: '6-8', locale: 'zh-CN', level: 1, seed: 'native-runtime', environment: { platform: 'ios', deviceClass: 'phone', input: 'touch', modality: 'visual' }, content: TEST_CONTENT });
  const session: Session = { id: plan.id, child_id: randomUUID(), plan, budget_ms: 480000, state: 'active', created_at: new Date().toISOString() };
  let clock = 0, saved: EngineEvent[] = [], server: EngineEvent[] = [], savesFail = false, receiptFails = false, removes = 0, finalizations = 0;
  const ports = {
    now: () => clock, uuid: randomUUID,
    journal: { async load() { return saved; }, async save(events: EngineEvent[]) { if (savesFail) throw new Error('Disk full'); saved = structuredClone(events); }, async remove() { saved = []; removes++; } },
    async send(events: EngineEvent[]) {
      for (const event of events) { const prior = server.find(e => e.seq === event.seq); if (prior) assert.deepEqual(prior, event); else server.push(event); }
      if (receiptFails) { receiptFails = false; throw new Error('Connection closed after server commit'); }
      return { highestContiguousSeq: server.length };
    },
    async finalize(lastSeq: number): Promise<Result> {
      finalizations++; assert.equal(lastSeq, server.length); const state = replay(plan, server);
      assert.equal(state.ended, true);
      return { sessionId: plan.id, task, condition: plan.condition, completed: state.endReason === 'completed', completedAt: new Date().toISOString(), metrics: metrics(state.results), trials: state.results, interruptions: state.interruptions, activeMs: state.activeMs, decision: { level: 1, reason: 'HOLD_TEST' } };
    },
  };
  return { session, ports, runtime: new SessionRuntime(session, ports), at(value: number) { clock = value; }, failSave(value: boolean) { savesFail = value; }, loseReceipt() { receiptFails = true; }, saved: () => saved, server: () => server, removes: () => removes, finalizations: () => finalizations };
}

test('all four native task plans persist, replay and synchronize their actual observations', async () => {
  for (const task of ['search', 'stop', 'memory', 'sustain'] as TaskId[]) {
    const h = harness(task); await h.runtime.initialize();
    for (const event of completeEvents(h.session.plan)) { h.at(event.at); await h.runtime.record([event as Action]); }
    assert.equal(h.runtime.state.ended, true); assert.ok(h.saved().length > 0);
    const result = await h.runtime.sync();
    assert.equal(result?.completed, true); assert.equal(result.metrics.accuracy, 1); assert.equal(h.removes(), 1);
    await h.runtime.sync(); assert.equal(h.finalizations(), 1);
  }
});
test('a lost receipt retries identical events and does not remove unconfirmed records', async () => {
  const h = harness('memory'); await h.runtime.initialize();
  for (const event of completeEvents(h.session.plan)) { h.at(event.at); await h.runtime.record([event as Action]); }
  h.loseReceipt(); await assert.rejects(h.runtime.sync(), /closed/);
  const retained = structuredClone(h.saved()); assert.ok(retained.length > 0); assert.equal(h.removes(), 0);
  await h.runtime.sync(); assert.deepEqual(h.server(), retained); assert.equal(h.removes(), 1);
});
test('storage failure does not publish an observation that was never durable', async () => {
  const h = harness(); await h.runtime.initialize(); h.failSave(true);
  const first = completeEvents(h.session.plan)[0];
  await assert.rejects(h.runtime.record([first as Action], first.at), /Disk full/);
  assert.equal(h.runtime.events.length, 0); assert.equal(h.runtime.state.active, null);
  h.failSave(false); await assert.rejects(h.runtime.record([first as Action], first.at), /reopen/);
  const reopened = new SessionRuntime(h.session, h.ports); await reopened.initialize();
  await reopened.record([first as Action], first.at); assert.equal(reopened.events.length, 1);
});
test('restoring an interrupted process invalidates its active trial without fabricating a score', async () => {
  const h = harness(), first = completeEvents(h.session.plan)[0]; await h.runtime.initialize();
  h.at(first.at); await h.runtime.record([first as Action]); h.runtime.stop();
  const restored = new SessionRuntime(h.session, h.ports); await restored.initialize();
  assert.equal(restored.state.results.length, 0); assert.equal(restored.state.active, null); assert.equal(restored.state.nextIndex, 0);
  assert.equal(restored.state.invalidations[0].reason, 'reload');
});
test('leaving the screen preserves already accepted writes and forbids subsequent inputs', async () => {
  const h = harness(), first = completeEvents(h.session.plan)[0]; await h.runtime.initialize();
  const writing = h.runtime.record([first as Action], first.at); h.runtime.stop(); await writing;
  assert.equal(h.saved().length, 1);
  await assert.rejects(h.runtime.record([{ type: 'interrupt', reason: 'pause' }]), /unavailable/);
});
test('a synchronization receipt cannot acknowledge observations beyond the saved snapshot', async () => {
  const h = harness(); h.ports.send = async () => ({ highestContiguousSeq: 9000 }); await h.runtime.initialize();
  const first = completeEvents(h.session.plan)[0]; await h.runtime.record([first as Action], first.at);
  await assert.rejects(h.runtime.sync(), /receipt/); assert.equal(h.saved().length, 1); assert.equal(h.removes(), 0);
});
test('resume retransmits a missing prefix even if later server events already exist', async () => {
  const h = harness(), events = completeEvents(h.session.plan).slice(0, 3);
  await h.ports.journal.save(events); await h.ports.send([events[2]]);
  const runtime = new SessionRuntime({ ...h.session, events: [events[2]] }, h.ports); await runtime.initialize();
  await runtime.sync();
  assert.deepEqual(h.server().sort((a, b) => a.seq - b.seq).slice(0, 3), events);
});
test('revocation can drain accepted writes before erasing so a late save cannot revive the journal', async () => {
  const h = harness(); await h.runtime.initialize();
  const original = h.ports.journal.save; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.ports.journal.save = async events => { await gate; await original(events); };
  const first = completeEvents(h.session.plan)[0]; const writing = h.runtime.record([first as Action], first.at);
  const revoked = h.runtime.stopAndDrain().then(() => h.ports.journal.remove());
  release(); await writing; await revoked; assert.equal(h.saved().length, 0);
  await assert.rejects(h.runtime.record([{ type: 'interrupt', reason: 'pause' }]), /unavailable/);
});
test('three formal search errors offer a pause and timed retries preserve the minimum interval', () => {
  const h = harness(), events = completeEvents(h.session.plan), formal = events.findIndex(e => e.type === 'present' && e.trialId === h.session.plan.trials[2].id);
  const prefix = events.slice(0, formal); let at = prefix.at(-1)!.at;
  for (const trial of h.session.plan.trials.slice(2, 5)) {
    prefix.push({ id: randomUUID(), seq: prefix.length + 1, at: at += 1000, type: 'present', trialId: trial.id, presentation: { assetsReady: true, frameDeltaMs: 16, method: 'native-frame' } });
    const before = replay(h.session.plan, prefix);
    prefix.push({ id: randomUUID(), seq: prefix.length + 1, at: at += 500, type: 'submit' });
    const after = replay(h.session.plan, prefix);
    if (trial === h.session.plan.trials[4]) assert.equal(phaseAfterSubmission(h.session.plan, before, after), 'pause');
  }
  const timed = harness('stop'); assert.equal(remainingInterval(timed.session.plan.trials[4], [{ id: randomUUID(), seq: 1, type: 'submit', at: 2000 }], 2010), 990);
});

test('a stalled presentation and its immediate interruption are both durable in one batch', async () => {
  const h = harness('stop'); await h.runtime.initialize();
  const trial = h.session.plan.trials[0];
  const commands: Action[] = [
    { type: 'present', trialId: trial.id, presentation: { assetsReady: true, frameDeltaMs: 140, method: 'native-frame' } },
    { type: 'interrupt', reason: 'render_failure' },
  ];
  // Both adapters use this reducer; the runtime additionally proves persistence.
  const reduced = appendObservations(h.session.plan, [], commands, 100, randomUUID, h.session.budget_ms);
  assert.deepEqual(reduced.events.map(e => e.type), ['present', 'interrupt']);
  const after = await h.runtime.record(commands, 100);
  assert.equal(after.active, null); assert.equal(after.nextIndex, 0); assert.equal(after.results.length, 0);
  assert.equal(after.invalidations[0].reason, 'render_failure'); assert.equal(h.saved().length, 2);
  await h.runtime.record([{ type: 'present', trialId: trial.id, presentation: { assetsReady: true, frameDeltaMs: 16, method: 'native-frame' } }], 500);
  assert.equal(h.runtime.state.active?.trial.id, trial.id);
});

test('stale commands in a batch do not discard the valid end command that follows', () => {
  const h = harness();
  const reduced = appendObservations(h.session.plan, [], [{ type: 'interrupt', reason: 'pause' }, { type: 'submit' }, { type: 'end', reason: 'child_stopped' }], 20, randomUUID);
  assert.deepEqual(reduced.events.map(e => e.type), ['end']);
  assert.equal(reduced.state.endReason, 'child_stopped');
  assert.equal(reduced.events[0].seq, 1);
});

test('slow storage does not move the response window or lose inputs observed before presentation was saved', async () => {
  const h = harness('stop'); await h.runtime.initialize();
  const lifecycle = new TrialLifecycle(), trial = h.session.plan.trials[0];
  const window = lifecycle.begin(trial, 100, h.runtime.state);
  const save = h.ports.journal.save; let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  h.ports.journal.save = async events => { await blocked; await save(events); };
  const presenting = h.runtime.record([{ type: 'present', trialId: trial.id, presentation: { assetsReady: true, frameDeltaMs: 16, method: 'native-frame' } }], window.onset);
  assert.equal(lifecycle.acceptsInput(500), true);
  const first = h.runtime.record([{ type: 'choose', index: 0, input: 'touch' }], 500);
  const second = h.runtime.record([{ type: 'choose', index: 0, input: 'touch' }], 650);
  assert.equal(lifecycle.acceptsInput(window.onset + trial.windowMs + 1), false);
  lifecycle.retire();
  const submitting = h.runtime.record([{ type: 'submit' }], window.onset + trial.windowMs + 5);
  // A visible response window is never evidence that an event was saved.
  assert.equal(h.runtime.events.length, 0); assert.equal(h.saved().length, 0);
  h.at(9000); release(); await Promise.all([presenting, first, second, submitting]);
  const result = h.runtime.state.results[0];
  assert.equal(result.correct, true); assert.equal(result.responseCount, 2);
  assert.equal(result.firstResponseMs, 400); assert.equal(result.durationMs, trial.windowMs);
  assert.equal(h.runtime.state.invalidations.length, 0);
  assert.deepEqual(h.saved().map(e => e.at), [100, 500, 650, 3705]);
});

test('backgrounding during a pending presentation closes input immediately and cannot be undone by its save callback', async () => {
  const h = harness('stop'); await h.runtime.initialize();
  const lifecycle = new TrialLifecycle(), trial = h.session.plan.trials[0];
  const save = h.ports.journal.save; let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  h.ports.journal.save = async events => { await blocked; await save(events); };
  const window = lifecycle.begin(trial, 100, h.runtime.state);
  let phase = 'active';
  const presenting = h.runtime.record([{ type: 'present', trialId: trial.id, presentation: { assetsReady: true, frameDeltaMs: 16, method: 'native-frame' } }], 100)
    .then(() => { if (lifecycle.isCurrent(window.revision)) phase = 'active'; });
  lifecycle.retire(); phase = 'pause';
  const interrupting = h.runtime.record([{ type: 'interrupt', reason: 'background' }], 150);
  assert.equal(lifecycle.acceptsInput(200), false);
  release(); await Promise.all([presenting, interrupting]);
  assert.equal(phase, 'pause'); assert.equal(h.runtime.state.active, null);
  assert.equal(h.runtime.state.results.length, 0); assert.equal(h.runtime.state.activeMs, 50);
  assert.equal(h.runtime.state.invalidations[0].reason, 'background');
});

test('a cancelled timer from an earlier attempt cannot interrupt a retry of the same trial', async () => {
  const h = harness('stop'); await h.runtime.initialize();
  const lifecycle = new TrialLifecycle(), trial = h.session.plan.trials[0];
  const present: Action = { type: 'present', trialId: trial.id, presentation: { assetsReady: true, frameDeltaMs: 16, method: 'native-frame' } };
  const original = lifecycle.begin(trial, 100, h.runtime.state);
  await h.runtime.record([present], 100);
  const oldCallback = async () => { if (lifecycle.isActive(original)) await h.runtime.record([{ type: 'interrupt', reason: 'render_failure' }], 900); };
  lifecycle.retire(); await h.runtime.record([{ type: 'interrupt', reason: 'pause' }], 200);
  const retry = lifecycle.begin(trial, 700, h.runtime.state); await h.runtime.record([present], 700);
  await oldCallback();
  assert.equal(lifecycle.isActive(retry), true); assert.equal(h.runtime.events.length, 3);
  assert.equal(h.runtime.state.active?.onset, 700); assert.equal(h.runtime.state.interruptions, 1);
});

test('a failed queued write stops later accepted commands instead of saving an end after a missing presentation', async () => {
  const h = harness(); await h.runtime.initialize();
  const save = h.ports.journal.save; let failed = false;
  h.ports.journal.save = async events => { if (!failed) { failed = true; throw new Error('Transient write failure'); } await save(events); };
  const first = completeEvents(h.session.plan)[0];
  const presenting = h.runtime.record([first as Action], first.at);
  const ending = h.runtime.record([{ type: 'interrupt', reason: 'pause' }, { type: 'end', reason: 'child_stopped' }], first.at + 200);
  const settled = await Promise.allSettled([presenting, ending]);
  assert.equal(settled[0].status, 'rejected'); assert.equal(settled[1].status, 'rejected');
  if (settled[1].status === 'rejected') assert.match(settled[1].reason.message, /reopen/);
  assert.deepEqual(h.saved(), []); assert.equal(h.runtime.state.ended, false);
});
