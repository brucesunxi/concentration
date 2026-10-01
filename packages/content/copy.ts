import type { TaskId, Locale, AgeBand, Item } from '../task-engine/index.ts';
export const translate = (locale: Locale) => (zh: string, en: string) => locale === 'en' ? en : zh;
export const isTeen = (age: AgeBand) => age === '12-14' || age === '15-17';
export function taskContent(task: TaskId, locale: Locale, age: AgeBand = '6-8') {
  const t = translate(locale), teen = isTeen(age);
  return {
    search: { title: teen ? t('视觉侦察', 'Visual scout') : t('森林寻宝', 'Forest search'), skill: t('看见目标', 'Notice the target'), rule: teen ? t('找出所有圆环。选好后，检查一次再提交。', 'Find every ring. Check your choices before you finish.') : t('找出所有的小兔子。找完以后，点找好了。', 'Find every rabbit. When you are ready, choose All found.'), strategy: t('一行一行找，找完再检查。', 'Look row by row, then check once more.'), transfer: t('整理一个小角落：先说出要找什么，再按区域检查。', 'Tidy a small space. Name what you need, then check one area at a time.'), color: 'sage', minutes: 4 },
    stop: { title: teen ? t('行动节奏', 'Pause & choose') : t('小兔过桥', 'Rabbit crossing'), skill: t('看清再行动', 'Pause before acting'), rule: teen ? t('圆环出现时点一下。其他图形出现时，等它离开。', 'Tap when you see a ring. Wait when you see another shape.') : t('小兔出现时点一下。其他动物出现时，等它离开。', 'Tap when a rabbit appears. Wait for the other animals to leave.'), strategy: t('先认清是谁，再决定要不要动手。', 'Look first. Then decide whether to act.'), transfer: t('和家人轮流选择活动，轮到别人时先等一等。', 'Take turns choosing an activity. Give the other person time for their turn.'), color: 'peach', minutes: 4 },
    memory: { title: teen ? t('路线记忆', 'Sequence studio') : t('森林小邮差', 'Little forest post'), skill: t('记住小顺序', 'Keep the sequence'), rule: t(teen ? '先看清物品顺序，记好后，按同样的顺序选择。' : '先看包裹的顺序，记好以后，按同样的顺序点选。', 'Look at the sequence. When ready, choose the items in the same order.'), strategy: t('分成小组，在心里说一遍顺序。', 'Make small groups and repeat the order to yourself.'), transfer: t('选择一个两到三步的小任务，先说出步骤；也可以写张清单。', 'Choose a short task with two or three steps. Say the steps, or make a checklist.'), color: 'lavender', minutes: 5 },
    sustain: { title: teen ? t('信号观察', 'Signal watch') : t('星星瞭望台', 'Star lookout'), skill: t('短段留意', 'Stay with one thing'), rule: t('看到星星，点一下。看到月亮，等它离开。', 'Tap when a star appears. Wait when you see a moon.'), strategy: t('每次只留意眼前这一个，想休息时随时停。', 'Notice just this moment. Take a break whenever you need one.'), transfer: t('选一小段阅读或拼装任务，走神后找回刚才做到的那一步。', 'Read or build for a short while. If distracted, find the step you were on.'), color: 'sand', minutes: 4 },
  }[task];
}
export function itemLabel(item: Item, locale: Locale, teen = false) {
  const labels: Record<Item, [string, string]> = { rabbit: teen ? ['圆环', 'Ring'] : ['小兔', 'Rabbit'], fox: teen ? ['菱形', 'Diamond'] : ['狐狸', 'Fox'], bear: teen ? ['三角形', 'Triangle'] : ['小熊', 'Bear'], cat: teen ? ['方块', 'Square'] : ['小猫', 'Cat'], apple: ['苹果', 'Apple'], leaf: ['叶子', 'Leaf'], flower: ['花朵', 'Flower'], berry: ['蓝莓', 'Berries'], star: ['星星', 'Star'], moon: ['月亮', 'Moon'] };
  return labels[item][locale === 'en' ? 1 : 0];
}
