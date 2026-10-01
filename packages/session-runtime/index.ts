import { canonical } from '../content/index.ts';
import { replay, TIMING } from '../task-engine/index.ts';
import type { Action, EngineEvent, Replay, Trial } from '../task-engine/index.ts';
import type { Session, Result } from '../contracts/models.ts';
import { appendObservations } from './observations.ts';

export function reconcile(server: EngineEvent[], local: EngineEvent[]) {
  const remote = new Map(server.map(e => [e.seq, e]));
  for (const event of local) {
    const prior = remote.get(event.seq);
    if (prior && canonical(prior) !== canonical(event)) throw new Error('保存记录发生冲突，已停止继续写入。');
    remote.set(event.seq, event);
  }
  const merged = [...remote.values()].sort((a, b) => a.seq - b.seq);
  if (merged.some((e, index) => e.seq !== index + 1)) throw new Error('练习记录不完整，暂时无法恢复。');
  return merged;
}
export function highestContiguousSeq(events: EngineEvent[]) {
  const sequences = new Set(events.map(e => e.seq)); let highest = 0;
  while (sequences.has(highest + 1)) highest++;
  return highest;
}

export interface JournalPort {
  load(): Promise<EngineEvent[]>;
  save(events: EngineEvent[]): Promise<void>;
  remove(): Promise<void>;
}
export interface RuntimePorts {
  now(): number;
  uuid(): string;
  journal: JournalPort;
  send(events: EngineEvent[]): Promise<{ highestContiguousSeq: number }>;
  finalize(lastSeq: number): Promise<Result>;
  authorize?(actions: Action[]): void;
}

/** Durable observations and ordered retries, independent of React and native APIs. */
export class SessionRuntime {
  readonly session: Session;
  readonly ports: RuntimePorts;
  events: EngineEvent[] = [];
  result: Result | null = null;
  private anchor = 0;
  private offset = 0;
  private ack = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private syncs: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private stopped = false;
  private ready = false;
  private writeFault = false;
  constructor(session: Session, ports: RuntimePorts) { this.session = session; this.ports = ports; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach(fn => fn()); }
  get state() { return replay(this.session.plan, this.events, this.session.budget_ms); }
  now() { return this.offset + Math.max(0, this.ports.now() - this.anchor); }
  async initialize() {
    if (this.ready) throw new Error('Runtime already initialized');
    const combined = reconcile(this.session.events ?? [], await this.ports.journal.load());
    replay(this.session.plan, combined, this.session.budget_ms);
    this.offset = combined.at(-1)?.at ?? 0; this.anchor = this.ports.now(); this.ack = highestContiguousSeq(this.session.events ?? []);
    await this.ports.journal.save(combined); this.events = combined; this.ready = true;
    // A previous process cannot testify how long the stimulus remained visible.
    if (this.state.active) await this.record([{ type: 'interrupt', reason: 'reload' }]);
    this.emit();
  }
  record(actions: Action[], observedAt = this.now()): Promise<Replay> {
    if (!this.ready || this.stopped) return Promise.reject(new Error('Runtime unavailable'));
    try { this.ports.authorize?.(actions); } catch (error) { return Promise.reject(error); }
    const operation = this.writes.then(async () => {
      if (this.writeFault) throw new Error('A recording failed; reopen to recover saved events');
      const { events: next, state: after } = appendObservations(this.session.plan, this.events, actions, observedAt, this.ports.uuid, this.session.budget_ms);
      if (next.length === this.events.length) return after;
      await this.ports.journal.save(next);
      this.events = next; this.emit(); return after;
    }).catch(error => { this.writeFault = true; throw error; });
    this.writes = operation.catch(() => undefined); return operation;
  }
  sync(): Promise<Result | null> {
    const operation = this.syncs.then(async () => {
      if (!this.ready || this.stopped) throw new Error('Runtime unavailable');
      if (this.result) return this.result;
      const snapshot = [...this.events];
      while (this.ack < snapshot.length) {
        const receipt = await this.ports.send(snapshot.slice(this.ack, this.ack + 100));
        if (!Number.isInteger(receipt.highestContiguousSeq) || receipt.highestContiguousSeq <= this.ack || receipt.highestContiguousSeq > snapshot.length) throw new Error('Invalid synchronization receipt');
        this.ack = receipt.highestContiguousSeq;
      }
      if (replay(this.session.plan, snapshot).ended) {
        const confirmed = await this.ports.finalize(snapshot.length);
        await this.ports.journal.remove(); this.result = confirmed; this.emit();
      }
      return this.result;
    });
    this.syncs = operation.catch(() => undefined); return operation;
  }
  stop() { this.stopped = true; this.listeners.clear(); }
  async settle() { await this.writes; }
  async stopAndDrain() { this.stop(); await this.writes; }
}

export function phaseAfterSubmission(plan: Session['plan'], before: Replay, after: Replay): 'pause' | 'feedback' | 'rest' | 'gap' {
  return phaseAfterTrial(plan, before.active?.trial, before.invalidations.length, after);
}
export function phaseAfterTrial(plan: Session['plan'], current: Trial | undefined, priorInvalidations: number, after: Replay): 'pause' | 'feedback' | 'rest' | 'gap' {
  if (after.invalidations.length > priorInvalidations) return 'pause';
  if (!current || current.practice || plan.version !== '2.0.0') return 'feedback';
  if (after.errorStreak >= 3) return 'pause';
  if (!current.windowMs) return 'feedback';
  return !plan.trials[after.nextIndex] || plan.trials[after.nextIndex].block !== current.block ? 'rest' : 'gap';
}
export function remainingInterval(trial: Trial, events: EngineEvent[], at: number) {
  if (!trial.windowMs || trial.practice) return 0;
  const prior = events.findLast(e => e.type === 'submit');
  return prior ? Math.max(0, TIMING.intervalMs - (at - prior.at)) : 0;
}
