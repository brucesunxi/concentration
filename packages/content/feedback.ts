import type { Locale, Trial, TrialResult } from '../task-engine/index.ts';
import { translate } from './copy.ts';

/** Guidance describes the scored response, never a guessed cause or child trait. */
export function feedbackGuidance(result: TrialResult, strategy: string, locale: Locale): string {
  if (result.correct || (result.task !== 'stop' && result.task !== 'sustain')) return strategy;
  const t = translate(locale);
  return result.falseAlarms > 0
    ? t('刚才不是目标，下一次先看清，再决定。', 'That was not the target. Look first, then decide.')
    : t('刚才是目标，看见它时可以点一下。', 'That was the target. Tap when you see it.');
}

export function searchTargetPositions(trial: Trial): number[] {
  if (trial.task !== 'search') return [];
  return trial.items.flatMap((item, index) => item === trial.target ? [index + 1] : []);
}
