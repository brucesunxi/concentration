import type { Locale } from '../task-engine/index.ts';
import { translate } from '../content/copy.ts';
import type { PracticePhase } from './practice-window.ts';

export function shouldPauseForBackground(phase: PracticePhase, activeTrial: boolean): boolean {
  return activeTrial || phase === 'arming' || phase === 'active' || phase === 'gap';
}

export function backgroundPauseCopy(locale: Locale, activeTrial: boolean): string {
  const t = translate(locale);
  return activeTrial
    ? t('刚才练习被打断，这一步已暂停，不算答错。准备好后可以重新尝试。',
        'The practice was interrupted. This step paused and does not count as a mistake. Try again when you are ready.')
    : t('刚才练习被打断了。准备好后可以继续。',
        'The practice was interrupted. Continue when you are ready.');
}
