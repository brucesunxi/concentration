import type { AgeBand, Locale } from '../task-engine/index.ts';

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
