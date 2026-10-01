import type { AgeBand, Locale } from '../task-engine/index.ts';

export type ChildDataVisibility = {
  title: string;
  introduction: string;
  practiceHeading: string;
  practice: string;
  reflectionHeading: string;
  reflection: string;
  controlHeading: string;
  control: string;
  device: string;
  close: string;
};

const copy: Record<AgeBand, Record<Locale, ChildDataVisibility>> = {
  '6-8': {
    'zh-CN': {
      title: '家长能看到什么？', introduction: '这里会记下你练过什么，帮助家长陪你安排练习和休息。',
      practiceHeading: '小游戏记录', practice: '能看你练习的时间、游戏和完成情况。家庭创建者还可以导出游戏中的操作记录。',
      reflectionHeading: '生活小目标', reflection: '家长能看到目标、约好的帮助，以及你有没有完成回顾。回顾里选的三个答案，只有你点“分享”后才会保存给家长看；不分享就不会保存。',
      controlHeading: '改变主意', control: '分享后可以移除答案。家长已经看过或下载过的内容，无法收回。',
      device: '在同一台设备旁边的人，也可能看到屏幕上正在显示的内容。', close: '知道了',
    },
    en: {
      title: 'What can parents see?', introduction: 'This app keeps track of your practice so your family can plan practice and rest with you.',
      practiceHeading: 'Game records', practice: 'Parents with access can see when and what you practiced and how it went. The family owner can also export your in-game actions.',
      reflectionHeading: 'Everyday goals', reflection: 'Parents can see your goal, the help you agreed on, and whether you finished reflecting. Your three answers are saved for them only if you choose “Share”. If you do not share, the answers are not saved.',
      controlHeading: 'Changing your mind', control: 'You can remove shared answers later. Copies someone has already seen or downloaded cannot be taken back.',
      device: 'Someone nearby may also see what is on a shared device screen.', close: 'Got it',
    },
  },
  '9-11': {
    'zh-CN': {
      title: '谁能看到我的记录？', introduction: '你可以了解哪些练习记录会给家长看，哪些回顾答案由你决定。',
      practiceHeading: '练习和进度', practice: '获准查看你档案的家长能看到练习时间、任务和结果。家庭创建者还可以导出每次练习的操作记录。',
      reflectionHeading: '生活回顾', reflection: '家长能看到目标、约定的帮助和回顾是否结束。具体三个答案默认不保存；只有你明确选择分享才会保存，并出现在家长记录及导出文件中。',
      controlHeading: '分享以后', control: '你可以移除已分享的答案，使它不再出现在这里和以后导出的文件里。已经看过或保存的副本无法收回。',
      device: '共用设备时，旁边的人可能看到屏幕上正在填写的内容。', close: '我明白了',
    },
    en: {
      title: 'Who can see my records?', introduction: 'You can check what practice information adults see and which reflection answers you choose to share.',
      practiceHeading: 'Practice and progress', practice: 'Parents with access to your profile can see practice dates, tasks, and results. The family owner can export the actions from each practice.',
      reflectionHeading: 'Everyday reflections', reflection: 'Parents can see goals, agreed support, and whether a reflection is finished. Your three answers are not saved by default. They are saved in family records and exports only when you choose to share them.',
      controlHeading: 'After sharing', control: 'You can remove shared answers from these records and future exports. Copies already seen or saved cannot be taken back.',
      device: 'On a shared device, someone nearby may see what you are choosing on the screen.', close: 'I understand',
    },
  },
  '12-14': {
    'zh-CN': {
      title: '我的数据会分享给谁？', introduction: '这些是当前家庭空间中的实际共享范围。你有权知道，但这里还不是独立的私人账号。',
      practiceHeading: '练习记录', practice: '获准访问你档案的家长可查看练习时间、任务、结果和进度；家庭创建者可导出逐次操作记录。',
      reflectionHeading: '你选择的回顾', reflection: '目标、帮助约定和是否完成回顾会给家长看。三个具体答案默认不保存；只有你明确选择分享才会保存，并出现在家长记录和导出文件中。',
      controlHeading: '撤回与限制', control: '以后可以移除已分享的答案，阻止它出现在后续查看和导出中；已经看过或下载的副本无法收回。',
      device: '如果共用设备，身边的人也可能看到屏幕上的选择。请不要把这里当成完全私密的空间。', close: '我知道了',
    },
    en: {
      title: 'Who is my data shared with?', introduction: 'These are the current sharing rules in your family space. You deserve to know them; this is not a separate private account.',
      practiceHeading: 'Practice records', practice: 'Parents with access to your profile can see dates, tasks, results, and progress. The family owner can export event-by-event actions.',
      reflectionHeading: 'Reflections you choose to share', reflection: 'Parents can see goals, agreed support, and whether you finished reflecting. Your three answers are not saved by default. They enter family records and exports only if you explicitly share them.',
      controlHeading: 'Removing shared answers', control: 'You can remove shared answers from future views and exports. Copies already seen or downloaded cannot be taken back.',
      device: 'Someone nearby may see choices on a shared device. Please do not treat this as a completely private space.', close: 'I understand',
    },
  },
  '15-17': {
    'zh-CN': {
      title: '了解我的数据边界', introduction: '当前使用家庭共享空间，而不是独立的青少年账号。下面说明家长能访问的记录，以及你能控制的部分。',
      practiceHeading: '练习数据', practice: '获准访问你档案的家长可查看练习日期、任务、结果和进度；家庭创建者可导出逐次操作事件。',
      reflectionHeading: '生活回顾的选择权', reflection: '目标、支持约定和完成状态对家长可见。具体三个答案默认不保存；仅在你明确分享后才进入家长记录及导出文件。',
      controlHeading: '撤回的实际范围', control: '你可以移除已分享的答案，之后的查看和导出不再包含它们；已被查看或下载的副本无法收回。',
      device: '共用设备上，旁人可能看到屏幕内容。当前版本不承诺独立账号级别的私密性。', close: '了解',
    },
    en: {
      title: 'Understand my data boundaries', introduction: 'This is a shared family space, not an independent teen account. Here is what adults can access and what you control.',
      practiceHeading: 'Practice data', practice: 'Parents with access to your profile can see dates, tasks, results, and progress. The family owner can export event-by-event actions.',
      reflectionHeading: 'Your reflection choice', reflection: 'Goals, agreed support, and completion status are visible to parents. Your three answers are not saved by default; they enter family records and exports only when you explicitly share them.',
      controlHeading: 'What removing answers does', control: 'You can remove shared answers from later views and exports. Copies already viewed or downloaded cannot be taken back.',
      device: 'People nearby may see the screen on a shared device. This version does not offer independent-account privacy.', close: 'Understood',
    },
  },
};

export function childDataVisibilityCopy(ageBand: AgeBand, locale: Locale): ChildDataVisibility {
  return copy[ageBand][locale];
}
