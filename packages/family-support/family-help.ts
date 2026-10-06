import type { Locale } from '../task-engine/index.ts';

export type FamilyHelpAction = 'limits' | 'recovery' | 'report';

type HelpCard = { title: string; body: string } & ({ action: FamilyHelpAction; actionLabel: string } | { action?: never; actionLabel?: never });
type HelpCopy = { title: string; introduction: string; cards: HelpCard[]; closing: string };

const copy: Record<'zh-CN' | 'en', Record<'parent' | 'child', HelpCopy>> = {
  'zh-CN': {
    child: {
      title: '需要帮忙吗？',
      introduction: '遇到难题可以停下来，也可以请家长陪你看看。今天不练也没关系。',
      cards: [
        { title: '不知道怎么做', body: '先看看示范，再试一次；还是不明白，就告诉家长。' },
        { title: '不想继续了', body: '可以结束这次练习。休息也是照顾自己的好办法。', action: 'limits', actionLabel: '看看练习与休息' },
      ],
      closing: '你不需要为了完成练习而忍着不舒服。',
    },
    parent: {
      title: '家庭使用帮助',
      introduction: '先处理孩子此刻的需要，再决定是否继续使用。以下入口可以帮助您找到已有的安排和记录。',
      cards: [
        { title: '孩子抗拒或感到挫败', body: '先停止本次练习，听听哪里让孩子不舒服。晚些时候可一起调整练习与休息安排，不必为完成次数施压。', action: 'limits', actionLabel: '查看练习与休息' },
        { title: '练习中断或换了设备', body: '先查看是否有未结束练习和已保存的记录，再决定是否恢复；不必立刻开始新的练习。', action: 'recovery', actionLabel: '查看未结束练习' },
        { title: '担心记录和资料', body: '查看这个孩子的记录、观察与资料管理。请在了解共享范围后，再决定是否继续记录或管理资料。', action: 'report', actionLabel: '查看记录与资料' },
        { title: '困难持续影响生活', body: '如果注意或活动上的困难持续、明显影响日常学习或生活，可以向所在地合适的专业人员咨询。本产品不能根据游戏表现判断原因，也不提供诊断。' },
      ],
      closing: '当前是开发预览，尚无人工客服或紧急求助服务。',
    },
  },
  en: {
    child: {
      title: 'Need a hand?',
      introduction: 'You can pause, ask a parent to help, or leave it for today. That is okay.',
      cards: [
        { title: 'I am not sure what to do', body: 'Look at the example and try once more. If it is still confusing, ask a parent.' },
        { title: 'I want to stop', body: 'You can end this practice. Taking a break is a good way to look after yourself.', action: 'limits', actionLabel: 'See practice & rest' },
      ],
      closing: 'You do not have to push through discomfort to finish a practice.',
    },
    parent: {
      title: 'Help for your family',
      introduction: 'Start with what your child needs right now, then decide whether to continue. These links lead to your existing plans and records.',
      cards: [
        { title: 'My child is frustrated or does not want to continue', body: 'Stop this practice and listen to what feels difficult. You can revisit the practice and rest plan later, without pressure to complete a target number.', action: 'limits', actionLabel: 'View practice & rest' },
        { title: 'A practice was interrupted or we changed devices', body: 'Check for unfinished practice and saved records before deciding whether to resume. There is no need to start a new practice right away.', action: 'recovery', actionLabel: 'View unfinished practice' },
        { title: 'I have questions about records or data', body: 'Review this child’s records, observations and data controls. Check what is shared before choosing whether to continue recording or manage data.', action: 'report', actionLabel: 'View records & data' },
        { title: 'Difficulties keep affecting everyday life', body: 'If difficulties with attention or activities persist and clearly affect learning or daily life, consider speaking with a suitable professional in your area. This product cannot identify causes from game performance or provide a diagnosis.' },
      ],
      closing: 'This is a development preview. Human support and emergency help are not available here.',
    },
  },
};

export function familyHelpCopy(locale: Locale, role: 'parent' | 'child'): HelpCopy {
  return copy[locale === 'en' ? 'en' : 'zh-CN'][role];
}
