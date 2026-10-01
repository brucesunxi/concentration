import { z } from 'zod';
import type { AgeBand, Locale } from '../task-engine/index.ts';

// Development safeguards, not a recommended screen-time allowance or treatment dose.
export const practiceWindowSchema = z.object({
  version: z.literal('practice-window-1'),
  maxElapsedMs: z.number().int().min(1).max(1800000),
  checkInAfterMs: z.number().int().min(1).max(360000),
}).strict();
export type PracticeWindowPolicy = z.infer<typeof practiceWindowSchema>;
export function practiceWindowPolicy(age: AgeBand): PracticeWindowPolicy {
  const [total, reminder] = { '6-8': [20, 4], '9-11': [25, 5], '12-14': [30, 6], '15-17': [30, 6] }[age];
  return { version: 'practice-window-1', maxElapsedMs: total * 60000, checkInAfterMs: reminder * 60000 };
}
export type PracticePhase = 'loading' | 'intro' | 'arming' | 'active' | 'settling' | 'feedback' | 'gap' | 'rest' | 'pause' | 'check-in' | 'summary';
const safePhases = new Set<PracticePhase>(['intro', 'arming', 'feedback', 'gap', 'rest', 'pause']);

/** No answer, emotion or score is collected. Reopening uses the original grant's elapsed time. */
export class PracticeCheckIn {
  private dueAt: number;
  private returnPhase: PracticePhase | null = null;
  readonly interval: number;
  constructor(policy: PracticeWindowPolicy) { this.interval = policy.checkInAfterMs; this.dueAt = this.interval; }
  get pending() { return this.returnPhase !== null; }
  request(elapsedMs: number, phase: PracticePhase, activeOrWriting: boolean) {
    if (this.pending || !Number.isFinite(elapsedMs) || elapsedMs < this.dueAt || activeOrWriting || !safePhases.has(phase)) return false;
    this.returnPhase = phase;
    return true;
  }
  continue(elapsedMs: number): PracticePhase | null {
    if (!this.pending || !Number.isFinite(elapsedMs)) return null;
    const phase = this.returnPhase;
    this.returnPhase = null;
    this.dueAt = Math.max(this.dueAt, elapsedMs) + this.interval;
    return phase;
  }
}

export function practiceWindowCopy(locale: Locale, recordUntil: string) {
  const en = locale === 'en';
  const deadline = new Intl.DateTimeFormat(en ? 'en' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(recordUntil));
  return {
    intro: en ? `This practice closes by ${deadline}, including instructions and breaks. There is no need to hurry; you can stop at any time.` : `这份练习最晚到 ${deadline}，包括看规则和休息的时间。不用赶，随时可以结束。`,
    title: en ? 'Would you like a break?' : '现在想休息一下吗？',
    body: en ? 'You have been here a little while. You can put the screen down, or continue if you feel ready. Your saved steps will stay.' : '已经在这里待了一会儿。可以先放下屏幕；如果准备好了，也可以继续。已经保存的步骤会保留。',
    stop: en ? 'Stop for today' : '今天到这里',
    proceed: en ? 'I feel ready to continue' : '我准备好了，继续',
    closed: en ? 'This practice window has closed. We have stopped new steps and kept the saved ones. Take a break; there is no need to make up unfinished steps.' : '这份练习的时间窗口已结束。已停下新题目，保存的步骤会保留。先休息，不用补做没完成的部分。',
  };
}
