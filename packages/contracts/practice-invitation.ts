import type { AgeBand, Locale } from '../task-engine/index.ts';
import type { PracticeLimits } from './practice-limits.ts';
import type { PracticeStartReview } from './index.ts';

type Invitation = { title: string; body: string; begin: string; later: string; parentHint: string };

const copy: Record<AgeBand, Record<Locale, Invitation>> = {
  '6-8': {
    'zh-CN': { title: '你想试试吗？', body: '这是一个短短的小游戏。看懂规则后再开始；如果不想玩，现在说“稍后再说”也可以。玩的时候随时能停下来。', begin: '我想开始', later: '稍后再说', parentHint: '请把屏幕交给孩子，让孩子自己选择。' },
    en: { title: 'Would you like to try?', body: 'This is a short game. First, we will show you how it works. You can choose “Not now” or stop whenever you want.', begin: 'I want to start', later: 'Not now', parentHint: 'Please hand the screen to your child so they can choose.' },
  },
  '9-11': {
    'zh-CN': { title: '这次由你决定', body: '先试一小段，弄懂规则后再正式练习。你可以现在开始，也可以稍后再说；开始后也能随时休息或结束。', begin: '现在开始', later: '稍后再说', parentHint: '请让孩子自己选择是否开始。' },
    en: { title: 'It is your choice', body: 'Try a short round and learn the rule before the practice begins. You can start now, choose “Not now”, or take a break and stop later.', begin: 'Start now', later: 'Not now', parentHint: 'Let your child decide whether to begin.' },
  },
  '12-14': {
    'zh-CN': { title: '想开始这段练习吗？', body: '这是一段短练习，没有排名。你可以先了解规则，再决定怎么做；也可以现在不开始，练习中随时能退出。', begin: '开始练习', later: '现在不想', parentHint: '请把决定权交给孩子，不需要解释为什么暂时不参加。' },
    en: { title: 'Ready for this practice?', body: 'This is a short practice with no ranking. You can learn the rule first, choose not to begin, or stop during practice.', begin: 'Begin practice', later: 'Not right now', parentHint: 'Leave the decision to your child; they do not need to explain a no.' },
  },
  '15-17': {
    'zh-CN': { title: '是否开始，由你决定', body: '你可以用几分钟试一种策略，也可以选择暂不参加。没有排名；开始后仍可暂停或退出。', begin: '我愿意开始', later: '暂不参加', parentHint: '请让青少年自行作答；拒绝不会生成这次练习。' },
    en: { title: 'You decide whether to begin', body: 'Spend a few minutes trying a strategy, or choose not to take part. There is no ranking, and you can pause or leave after starting.', begin: 'I choose to begin', later: 'Not taking part now', parentHint: 'Let your teen answer for themselves; declining does not create a practice session.' },
  },
};

export function practiceInvitationCopy(ageBand: AgeBand, locale: Locale): Invitation {
  return copy[ageBand][locale];
}

export function practiceStartReview(limits: PracticeLimits, locale: Locale): PracticeStartReview {
  return { version: 'practice-start-review-1', day: limits.day, settingsVersion: limits.settingsVersion,
    ageBand: limits.ageBand, locale, currentMinutes: limits.currentMinutes, confirmedMs: limits.confirmedMs,
    reservedMs: limits.reservedMs, availableMs: limits.availableMs };
}

export function practiceInvitationRefreshCopy(locale: Locale) {
  return locale === 'en' ? {
    loading: 'Checking today’s plan…', failed: 'Today’s plan could not be confirmed. Check your connection and try again; you can also choose not to start.',
    refresh: 'Check today’s plan again', changed: 'Your family’s plan has updated. Have another look; you still decide whether to begin.',
  } : {
    loading: '正在确认今天的安排…', failed: '暂时无法确认今天的安排。可以联网后再试，也可以现在不开始。',
    refresh: '再确认今天的安排', changed: '家里的安排已更新。再看一看，是否开始仍由你决定。',
  };
}

export function practiceInvitationDay(limits: PracticeLimits, locale: Locale) {
  const t = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  if (!limits.collectionActive || limits.status === 'collection-stopped') return {
    mayStart: false,
    message: t('这份档案已停止新练习。已有记录仍可在家庭空间查看。', 'New practice has stopped for this profile. Saved records remain available in your family space.'),
  };
  if (limits.status === 'paused') return {
    mayStart: false,
    message: t('家里安排今天先休息。可以去生活里试试一个小策略。', 'Your family has planned a rest day. You can try a small strategy in everyday life.'),
  };
  if (limits.status === 'reserved') return {
    mayStart: false,
    message: t('还有一份未结束或未确认的练习。请先和家长一起恢复或处理记录。', 'There is an unfinished or unconfirmed practice. Please recover or resolve its record with a parent first.'),
  };
  if (limits.availableMs < 5000) return {
    mayStart: false,
    message: t('今天的练习安排已经够了，不需要再开一份。', 'Today’s practice allowance is complete. There is no need to start another.'),
  };
  if (limits.confirmedMs > 0) return {
    mayStart: true,
    message: t('今天已经练习过了。可以先离开屏幕，把刚试过的策略用在生活里；不必用完剩余时间。', 'You have already practised today. You can step away and try that strategy in everyday life; there is no need to use the remaining time.'),
  };
  return { mayStart: true, message: '' };
}
