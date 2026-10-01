import type { Locale } from '../task-engine/index.ts';
import type { TeenStrategyStatus } from './teen-strategy-history.ts';

export function teenStrategyCopy(locale: Locale) {
  const en = locale === 'en';
  return {
    title: en ? 'My strategy trail' : '我的策略足迹',
    introduction: en ? 'See which tasks you tried and a strategy you can choose next time. This is not an attention score or a ranking.' : '看看尝试过哪些任务，以及下次可以选择的策略。这里没有“专注力总分”或排名。',
    familyNote: en ? 'Parents with access can see practice records. Your everyday reflection answers are shared only when you choose to share them.' : '获准访问的家长可以看练习记录；生活回顾的具体答案由你选择是否分享。',
    currentSuggestion: en ? 'A strategy to try next time' : '下次可以试试',
    empty: en ? 'No finished practice records yet. You can begin when you are ready.' : '还没有结束的练习记录。准备好时再开始就可以。',
    loading: en ? 'Reading your practice trail…' : '正在读取你的策略足迹…',
    retry: en ? 'Try again' : '重试',
    newer: en ? 'Newer' : '较新的记录',
    older: en ? 'Older' : '较早的记录',
    page: (n: number) => en ? `Page ${n}` : `第 ${n} 页`,
    back: en ? 'Back to today' : '返回今天',
    error: en ? 'Your records could not be loaded. Try again.' : '暂时无法读取记录，请重试。',
    denied: en ? 'This child session can no longer read these records. Return to your family space.' : '当前孩子会话已无法读取这些记录，请返回家庭空间。',
    status: (value: TeenStrategyStatus) => ({
      completed: en ? 'Practice finished' : '完成练习',
      stopped: en ? 'Stopped early' : '提前结束',
      'previous-device': en ? 'From another device · not counted in the course' : '换设备前记录 · 不计入课程',
    })[value],
  };
}
