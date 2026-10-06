import type { Item, Locale, TaskId } from '../task-engine/index.ts';
import { translate } from './copy.ts';

export interface RuleExamples {
  target: Item;
  others: readonly Item[];
  targetAction: string;
  otherAction: string;
}

// These illustrations show the same target and distractor vocabulary as the
// task engine. Memory uses an ordered demonstration instead of this contrast.
export function ruleExamples(task: TaskId, locale: Locale): RuleExamples | null {
  const t = translate(locale);
  if (task === 'search') return {
    target: 'rabbit', others: ['fox', 'bear', 'cat'],
    targetAction: t('找出全部', 'Find all of these'),
    otherAction: t('不是目标', 'Not the target'),
  };
  if (task === 'stop') return {
    target: 'rabbit', others: ['fox', 'bear', 'cat'],
    targetAction: t('出现时点一下', 'Tap when it appears'),
    otherAction: t('出现时等一等', 'Wait when these appear'),
  };
  if (task === 'sustain') return {
    target: 'star', others: ['moon'],
    targetAction: t('出现时点一下', 'Tap when it appears'),
    otherAction: t('出现时等一等', 'Wait when this appears'),
  };
  return null;
}
