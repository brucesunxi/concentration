import type { AgeBand, Locale } from '../task-engine/index.ts';
import type { LifeTemplate, Words, Support, GoalState, Reflection } from './model.ts';

const w = (zh: string, en: string): Words => ({ 'zh-CN': zh, en });
export function lifeTemplates(age: AgeBand): LifeTemplate[] {
  const young = age === '6-8', teen = age === '12-14' || age === '15-17', older = age === '15-17';
  const base = { version: 'family-life-1', review: 'unreviewed' as const, ageBand: age };
  return [
    { ...base, id: 'find', task: 'search', title: young ? w('找齐两件小物品', 'Find two little things') : teen ? w('准备一次自己的活动', 'Get ready for your activity') : w('准备明天的小清单', 'Get a small list ready'), steps: [
      young ? w('选两件熟悉的物品，和家人说说要找什么。', 'Choose two familiar things and name them with someone at home.') : teen ? w('选一个自己的活动，列出两三件会用到的物品。', 'Choose an activity and list two or three things you will use.') : w('选明天要用的三件物品，先说出它们的名字。', 'Choose three things for tomorrow and name them first.'),
      w('一次查看一个小区域；找到了就放到一起。', 'Check one small area at a time. Put what you find together.'),
      w('按刚才的清单检查一次，然后就可以结束。', 'Check your list once, then finish.'),
    ], parentTip: w('先问是否需要帮助。需要时只提示“下一处想看哪里”，不替孩子寻找或增加物品。', 'Ask whether help is wanted. If it is, ask “Where would you like to look next?” without finding things for them or adding more items.') },
    { ...base, id: 'turns', task: 'stop', title: teen ? w('轮流决定一个小安排', 'Take turns making a small choice') : w('一起轮流选一选', 'Take turns choosing'), steps: [
      teen ? w('和家人选一个双方都愿意商量的小安排。', 'Pick a small plan you both want to discuss.') : w('和家人选一个双方都喜欢的小游戏或活动。', 'Pick a little game or activity you both enjoy.'),
      w('先商量谁先说。轮到别人时，听完再决定自己想说什么。', 'Agree who goes first. Let the other person finish before deciding what to say.'),
      w('每人轮到一次就够了。任何人都可以说想停。', 'One turn each is enough. Either person can ask to stop.'),
    ], parentTip: w('家长也遵守轮流。意见不同可以保留，不把安静或同意大人当作“成功”。', 'Take your turn too. Different opinions are allowed; being quiet or agreeing with an adult is not the measure of success.') },
    { ...base, id: 'steps', task: 'memory', title: older ? w('拆开一个项目的起步动作', 'Break down the start of a project') : teen ? w('写下一个任务的小步骤', 'Write small steps for a task') : young ? w('试试两步整理', 'Try a two-step tidy') : w('做一张自己的步骤卡', 'Make your own step card'), steps: [
      young ? w('选一个小地方，和家人说好两步：先收什么，再放哪里。', 'Choose a small spot. Agree on two steps: what to collect, then where it goes.') : w('选一个小任务，只写下开始时的两到三步。', 'Choose a small task. Write only the first two or three steps.'),
      w('一次做一步，可以随时看清单，也可以求助。', 'Try one step at a time. You can check your list or ask for help.'),
      w('看一眼清单，记下做到哪里；剩下的可以下次再做。', 'Check where you got to. The rest can wait until another time.'),
    ], parentTip: w('清单是可以使用的工具，不是作弊。不要故意把清单藏起来，也不追加记忆测验。', 'A checklist is a useful tool. Do not hide it or add a memory test afterwards.') },
    { ...base, id: 'return', task: 'sustain', title: teen ? w('找回项目的当前一步', 'Find your place in a project') : w('找到刚才做到哪里', 'Find where you were'), steps: [
      young ? w('选一小段共读或拼装，先看看现在要做哪一步。', 'Choose a little shared reading or building. Notice the step you are on.') : w('选一小段阅读、拼装或个人项目，先指出眼前的一步。', 'Choose a little reading, building or project work. Point out the current step.'),
      w('如果被别的事吸引，停一下，找回刚才的位置。', 'If something else catches your attention, pause and find your place again.'),
      w('想休息就停。回来时，可以留下一个书签或小标记。', 'Stop when you want a break. Leave a bookmark or small marker for your return.'),
    ], parentTip: w('一起减少一种干扰就好。不计连续专注时长，不因为走神批评孩子，也不要求补做。', 'Reduce one distraction together. Do not time an unbroken streak, criticise distraction or require extra practice.') },
  ];
}
export const supportLabels: Record<Support, Words> = {
  together: w('先陪我做第一步', 'Join me for the first step'),
  'ask-first': w('先问我需不需要帮助', 'Ask me before helping'),
  space: w('让我先试，需要时我会求助', 'Let me try; I can ask for help'),
};
export const stateLabels: Record<GoalState, Words> = { proposed: w('等待一起商量', 'Ready to discuss'), active: w('愿意试一小步', 'A small step to try'), reflected: w('已记录这次回顾', 'Reflection recorded'), declined: w('这次不选它', 'Not this one'), stopped: w('已经停下', 'Stopped') };
export const reflectionLabels: { [K in keyof Reflection]: Record<Reflection[K], Words> } = {
  outcome: { tried: w('试过了', 'I tried it'), partly: w('试了一部分', 'I tried part of it'), 'not-today': w('今天没试', 'Not today') },
  helpful: { yes: w('这个方法有帮助', 'It helped'), no: w('没帮到我', 'It did not help'), unsure: w('还说不清', 'I am not sure') },
  next: { same: w('下次还这样试', 'Try it again'), smaller: w('把下一步变小一点', 'Make the next step smaller'), different: w('换一个方法或任务', 'Try something different'), rest: w('先休息', 'Take a break') },
};
export const reflectionQuestions: Record<keyof Reflection, Words> = {
  outcome: w('这次做了多少？', 'What did you try?'),
  helpful: w('这个方法对你怎样？', 'How was this strategy for you?'),
  next: w('接下来想怎样？', 'What would you like next?'),
};
export const reflectionLines = (value: Reflection, locale: Locale) => [
  reflectionLabels.outcome[value.outcome][locale],
  reflectionLabels.helpful[value.helpful][locale],
  reflectionLabels.next[value.next][locale],
];
export function lifeError(code: string, locale: Locale) {
  const messages: Record<string, Words> = {
    GOAL_EXISTS: w('已经有一个待商量或正在尝试的目标，请先看看它。', 'There is already a goal to discuss or try. Take a look at it first.'),
    GOAL_CONFLICT: w('这份目标已在另一处更新。请查看最新内容后重新选择。', 'This goal changed elsewhere. Review the latest version before choosing again.'),
    GOAL_CLOSED: w('这次目标已结束，请查看最新记录。', 'This goal is closed. Check the latest record.'),
    FAMILY_CONTENT_UPDATE_REQUIRED:w('内容服务或应用需要更新，请更新后重新读取。','Update the service or app, then refresh the content.'),
    FAMILY_CONTENT_CHANGED:w('内容已更新，请阅读新版后重新选择。','The content changed. Read the new version before choosing again.'),
    FAMILY_CONTENT_RECALLED:w('此内容已召回。可以结束目标，已有记录仍可查看。','This content was recalled. You can stop the goal and read existing records.'),
    FAMILY_CONTENT_EXPIRED:w('此内容的预览期已结束。可以结束目标，已有记录仍可查看。','This preview expired. You can stop the goal and read existing records.'),
    FAMILY_CONTENT_UNAVAILABLE:w('此内容暂不可用，请刷新后查看。','This content is unavailable. Refresh to check its status.'),
    SHARING_CHOICE_REQUIRED:w('请更新应用，再明确选择是否分享这次回顾。原有记录保持不变。','Update the app and choose whether to share this reflection. Existing records are unchanged.'),
    SHARING_UPDATE_REQUIRED:w('家庭服务需要更新后，才能使用回顾分享选择。请稍后重新读取。','The family service needs an update before reflection sharing is available. Refresh after it has been updated.'),
    REFLECTION_WITHDRAWN:w('答案已撤回，旧的分享请求不会重新保存。','The answers were removed. An old sharing request cannot restore them.'),
    REFLECTION_NOT_SHARED:w('这份回顾没有可移除的已分享答案，请查看最新记录。','This reflection has no shared answers to remove. Check the latest record.'),
    REAUTH_REQUIRED:w('请返回家长空间重新验证密码，再移除答案。','Return to the parent space and verify your password again before removing answers.'),
    CHILD_REQUIRED: w('这一步需要在孩子空间里选择。', 'Make this choice in the child space.'),
    PARENT_REQUIRED: w('家长空间已关闭，请返回后重新进入。', 'Parent access has ended. Return and sign in again.'),
    LOAD_FAILED: w('还没有读取到记录，请检查连接后刷新。', 'Records could not be loaded. Check your connection and refresh.'),
    LIFE_HISTORY_PAGE_FAILED:w('暂时无法读取这一页，当前记录和页码没有改变。请检查连接后重试。','This page could not be loaded. Your records and page number have not changed. Check your connection and retry.'),
    INVALID_LIFE_HISTORY_CURSOR:w('历史记录位置已不可用，请重新读取最新目标与记录。','This history position is unavailable. Reload the latest goal and records.'),
    LIFE_HISTORY_UPDATE_REQUIRED:w('生活记录服务或应用需要更新，请更新后重新读取。','Update the everyday-goals service or app, then reload the records.'),
    OWNER_REQUIRED:w('生活目标与回顾需要由家庭创建者或对应孩子查看。','Goals and reflections are available to the family owner and the corresponding child.'),
    MEMBER_PENDING:w('家庭权限尚未确认，请返回家庭空间。','Family access has not been confirmed. Return to your family space.'),
    REFRESH_REQUIRED: w('这次选择已保存，但最新列表还未读取到。请刷新记录。', 'Your choice was saved, but the latest list could not be loaded. Refresh the records.'),
    IDEMPOTENCY_CONFLICT: w('这次请求与已保存的选择不同，请刷新记录后重新选择。', 'This request differs from the saved choice. Refresh the records before choosing again.'),
    CONSENT_REVOKED: w('此档案已停止采集，已有记录仍可查看。', 'Collection has stopped. Existing records remain available.'),
    ACCESS_CHANGED: w('家庭权限已变化，请返回家庭空间。', 'Access has changed. Return to your family space.'),
    NOT_FOUND: w('目标或档案已不可用，请返回家庭空间。', 'This goal or profile is unavailable. Return to your family space.'),
    UNAUTHENTICATED: w('请重新进入家庭空间。', 'Please reopen your family space.'),
  };
  return (messages[code] ?? w('暂时没有确认保存成功，请检查连接后重试。', 'Saving is not confirmed. Check your connection and retry.'))[locale];
}

export const sharingLabels:Record<import('./model.ts').ReflectionSharing,Words>={
  'not-recorded':w('还没有回顾','No reflection yet'),
  'legacy-family':w('旧版保存的答案，家长可见','Answers saved under the previous family-visible setting'),
  family:w('本次答案已分享到家庭空间','These answers are shared with your family'),
  'not-stored':w('只记录回顾已结束，没有保存答案','Reflection finished; answers were not saved'),
  withdrawn:w('已移除分享的答案，只保留回顾结束记录','Shared answers removed; only the finished reflection is recorded'),
};
