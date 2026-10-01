import type { AgeBand } from '../task-engine/index.ts';
import { courseUnit } from '../task-engine/index.ts';
import type { Words } from './model.ts';
import { PARENT_GUIDE_VERSION } from './parent-guide-model.ts';
import type { ParentLesson, ParentGuide, GuideStage } from './parent-guide-model.ts';

const w = (zh: string, en: string): Words => ({ 'zh-CN': zh, en });
type Examples = Record<AgeBand, Words>;
type LessonSource = Omit<ParentLesson, 'example'> & { examples: Examples };

// Original product drafts. The cited background in PARENT-GUIDE.md is not an
// approval of these scripts, their age bands or the product's effectiveness.
const lessons: LessonSource[] = [
  {
    stage: 0, title: w('开始之前：先听孩子的想法', 'Before you start: listen first'),
    purpose: w('先商量是否愿意试、何时停、需要什么帮助。家长的建议要留出拒绝的空间。', 'Agree whether to try, when to stop and what help would be welcome. Leave room to decline a parent’s suggestion.'),
    invitation: w('“想一起看看吗？可以只看示范，也可以今天不做。你想让我怎样帮忙？”', '“Would you like to look together? We can just watch the example, or leave it for today. What help would you like?”'),
    examples: {
      '6-8': w('和孩子一起看一个示范，请孩子用自己的话或动作表示下一步。', 'Watch one example together and invite your child to show or describe the next step.'),
      '9-11': w('让孩子先选一种愿意尝试的活动，再一起看规则。', 'Invite your child to choose an activity to try, then look at its rule together.'),
      '12-14': w('先问孩子希望解决哪件具体小事，允许与家长的想法不同。', 'Ask which small everyday task they want to work on. It can differ from your suggestion.'),
      '15-17': w('由青少年决定要不要尝试、想得到什么支持，以及哪些想法愿意分享。', 'Let your teen decide whether to try, what support they want and which thoughts to share.'),
    },
    steps: [w('找一个不赶时间的片刻，先问是否愿意。', 'Choose a moment without a rush and ask whether they want to try.'), w('一起找到帮助、暂停和结束入口。', 'Find the help, pause and stop controls together.'), w('只商量一次小尝试；孩子可以改变主意。', 'Agree on one small attempt. They can change their mind.')],
    fallback: w('没听懂时再看一次示范，或先离开屏幕。不愿意时就结束这次邀请。', 'If the rule is unclear, revisit the example or leave the screen. If they decline, end this invitation.'),
    notice: w('留意孩子是否能表达自己的选择。配合完成不代表已经理解或同意。', 'Notice whether they can express a choice. Finishing cooperatively does not establish understanding or agreement.'),
    templateId: null, task: null,
  },
  {
    stage: 1, title: w('先确认目标，再看一小片', 'Choose a target, then look in one area'),
    purpose: w('把“认真找”变成一个具体动作：先知道找什么，再分小片查看。', 'Turn “look carefully” into an action: decide what to find, then look in one small area.'),
    invitation: w('“我们先找哪一样？从这边开始，还是你选一个地方？”', '“Which item shall we look for first? Start here, or choose a place yourself?”'),
    examples: {
      '6-8': w('在一小块桌面找两件熟悉物品，孩子可以指一指，不需要说出名称。', 'Look for two familiar objects on a small part of a table. Pointing is enough; naming is optional.'),
      '9-11': w('按孩子选的小清单准备明天用品，先找一项，再勾一项。', 'Use a short list your child chooses to prepare tomorrow’s things, checking one item at a time.'),
      '12-14': w('为自己选择的活动找材料，按位置分区，允许使用清单。', 'Find materials for an activity they choose. Search by area and allow a checklist.'),
      '15-17': w('为个人项目整理所需材料，先确定这一小步需要什么。', 'Gather materials for a personal project, first deciding what this one step needs.'),
    },
    steps: [w('让孩子选择一两样要找的物品。', 'Invite them to choose one or two things to find.'), w('一次只看一小片区域，找到后再换。', 'Look in one small area at a time, then move on.'), w('最后一起核对清单，允许漏了再找。', 'Check the list together at the end. Missing something is a reason to look again.')],
    fallback: w('一起把范围缩小，减少同时要找的物品。先问是否需要提示，不替孩子抢答。', 'Narrow the area and reduce the number of items. Ask before giving a hint; leave the finding to them.'),
    notice: w('看是否用过分区或清单。不用找到的速度评价专注力。', 'Notice use of an area or list. Finding speed is not an attention rating.'),
    templateId: 'find', task: 'search',
  },
  {
    stage: 2, title: w('先停一下，再轮到我', 'Pause, then take a turn'),
    purpose: w('在一个共同活动中，把轮流规则说清楚。允许表达不同意见。', 'Make turn-taking clear in a shared activity. Different opinions are welcome.'),
    invitation: w('“我们怎样轮流比较合适？轮到你之前，需要一个提醒吗？”', '“How shall we take turns? Would a reminder help before your turn?”'),
    examples: {
      '6-8': w('共同搭一个小造型，每人放一块；家长也按商量好的顺序来。', 'Build a small shape together, placing one piece each. Follow the agreed order yourself too.'),
      '9-11': w('共同设计一张卡片，每人提出一个想法，再商量下一步。', 'Design a card together. Offer one idea each, then agree on the next step.'),
      '12-14': w('商量一个共同活动，轮流提出选择，不要求最后选家长的方案。', 'Plan a shared activity by taking turns offering options. The parent’s option does not have to win.'),
      '15-17': w('讨论一个双方都需要参与的安排，先听完一项建议再回应。', 'Discuss an arrangement that involves both of you. Hear one suggestion before responding.'),
    },
    steps: [w('共同决定一个活动和轮流方式。', 'Agree on an activity and how to take turns.'), w('家长示范等待，也尊重孩子提出的规则。', 'Model waiting and respect rules your child proposes too.'), w('一轮后问要继续、改规则还是结束。', 'After one round, ask whether to continue, change the rule or stop.')],
    fallback: w('觉得等待太难，就缩短一轮；发生争执时先暂停，之后再谈。', 'Shorten a round if waiting feels difficult. Pause a disagreement and return to it later.'),
    notice: w('留意轮流约定有没有说清楚。安静、听话或认同家长不等于抑制控制进步。', 'Notice whether the turn-taking agreement was clear. Silence, obedience or agreement with a parent is not evidence of improved inhibition.'),
    templateId: 'turns', task: 'stop',
  },
  {
    stage: 3, title: w('把事情拆开，让步骤看得见', 'Break a task into visible steps'),
    purpose: w('把眼前的事拆成两三步，允许用图、字或物品提醒。', 'Break a task into two or three steps, using pictures, words or objects as reminders.'),
    invitation: w('“第一小步是什么？要不要画下来，做完再看下一步？”', '“What is the first small step? Shall we draw it and look again when that step is done?”'),
    examples: {
      '6-8': w('整理一小块地方：先把两样东西放回去，再看看完成了哪一步。', 'Tidy a small space: put two things back, then check which step is done.'),
      '9-11': w('做一张自己的步骤卡，写字或画图都可以，放在需要时看得到的地方。', 'Make a personal step card with words or drawings and keep it where it can be seen.'),
      '12-14': w('把自己选的作业准备或活动准备拆成两三步，允许随时查表。', 'Split preparation for schoolwork or an activity they choose into two or three steps. Keep the list available.'),
      '15-17': w('把一个个人项目拆出能开始的第一步，其他部分可以之后再规划。', 'Find a first actionable step in a personal project. The rest can be planned later.'),
    },
    steps: [w('请孩子决定从哪一小步开始。', 'Invite them to choose the first small step.'), w('把两三步写下或画下，留在手边。', 'Write or draw two or three steps and keep them nearby.'), w('完成一步就核对，再决定继续还是休息。', 'Check after one step, then decide whether to continue or rest.')],
    fallback: w('步骤太多时只留第一步。清单是帮助工具，不要收走它来考记忆。', 'If there are too many steps, keep just the first. A checklist is a support; do not remove it to test memory.'),
    notice: w('留意是否愿意看步骤卡或求助。使用提醒不代表退步。', 'Notice whether they use the step card or ask for help. Using a reminder is not a setback.'),
    templateId: 'steps', task: 'memory',
  },
  {
    stage: 4, title: w('走神后，找到回来的一步', 'Find a way back after a distraction'),
    purpose: w('把目标放在“知道下一步是什么”，允许分心、休息和回来。', 'Focus on knowing the next step, allowing distraction, rest and return.'),
    invitation: w('“刚才做到哪里了？要留一个记号，还是先休息？”', '“Where did you get to? Would you like to leave a marker or take a break?”'),
    examples: {
      '6-8': w('看一小段图画书或搭一小部分积木，暂停时留下一个位置标记。', 'Read a little of a picture book or build a small section. Leave a marker when pausing.'),
      '9-11': w('在自己的阅读或制作中，写下“下次从这里开始”。', 'During reading or making something, mark where to start next time.'),
      '12-14': w('做自己选的一小段任务，被打断后先找回上一步，不要求从头重来。', 'Try a small part of a chosen task. After interruption, find the last step without having to restart.'),
      '15-17': w('做个人项目时保留一个下一步提示，自行决定何时返回。', 'Leave a next-step note in a personal project and decide when to return.'),
    },
    steps: [w('先说清眼前要做的一小步。', 'Name the small step in front of you.'), w('一起减少一个可以调整的干扰。', 'Together, reduce one distraction that can be changed.'), w('暂停时留记号，让之后回来更容易。', 'Leave a marker when pausing to make returning easier.')],
    fallback: w('累了或烦了就停下，把事情再缩小。不要用加练或延长时间回应走神。', 'Stop if tired or frustrated and make the task smaller. Do not respond to distraction with extra practice or longer time.'),
    notice: w('留意孩子有没有找到下一步或主动休息。持续时间不能单独说明专注能力。', 'Notice finding the next step or choosing a break. Time spent alone does not establish attention ability.'),
    templateId: 'return', task: 'sustain',
  },
  {
    stage: 5, title: w('换个场景，再试熟悉的方法', 'Try a familiar strategy somewhere else'),
    purpose: w('换一种材料，继续尝试先定目标、分区查看。新场景可能需要重新示范。', 'Try choosing a target and looking by area with different materials. A new setting may need another demonstration.'),
    invitation: w('“上次哪个办法方便一些？今天换个地方，要不要再试试？”', '“Which approach was useful last time? Would you like to try it in a different place?”'),
    examples: {
      '6-8': w('从桌面找物换到整理画画用品，仍然一次找一两样。', 'Move from finding things on a table to gathering drawing materials, still one or two at a time.'),
      '9-11': w('把准备书包的小清单用到自己选的运动或手工活动。', 'Try a packing checklist for a sport or craft activity your child chooses.'),
      '12-14': w('为另一个感兴趣的活动列短清单，自己决定分类方式。', 'Make a short list for another activity of interest, choosing how to group items.'),
      '15-17': w('把项目材料清单用到另一项个人计划，保留有用部分即可。', 'Try a materials checklist in another personal plan, keeping only what helps.'),
    },
    steps: [w('回想一个愿意再试的方法，也可以说还没找到。', 'Recall an approach worth trying again, or say none has helped yet.'), w('只换一种材料或场景，先维持小范围。', 'Change one material or setting and keep the scope small.'), w('尝试后问哪里方便、哪里需要改。', 'Afterward, ask what was useful and what needs changing.')],
    fallback: w('新场景不顺利时回到熟悉的材料，或改用其他工具。不要说“明明已经会了”。', 'Return to familiar materials or try another tool if the new setting is difficult. Avoid “You already know this.”'),
    notice: w('记住具体场景是否不同。游戏里熟练不保证生活里同样容易。', 'Notice how the setting differs. Being familiar with a game does not guarantee an everyday task is easy.'),
    templateId: 'find', task: 'search',
  },
  {
    stage: 6, title: w('把选择与提醒方式交还给孩子', 'Let your child choose how reminders work'),
    purpose: w('在共同活动里商量提醒方式，让孩子可以拒绝或修改建议。', 'Agree on reminders in a shared activity, letting your child decline or change a suggestion.'),
    invitation: w('“轮到你时希望怎么提醒？不要提醒也可以，我们可以再商量。”', '“How would you like a reminder when it is your turn? No reminder is an option too; we can discuss it again.”'),
    examples: {
      '6-8': w('轮流玩一个小游戏，由孩子选择点头、指一指或口头提醒。', 'Take turns in a short game and let your child choose a nod, a gesture or a spoken reminder.'),
      '9-11': w('共同制作时让孩子提出一个轮流办法，并约定何时可以修改。', 'While making something together, invite your child to propose a turn-taking rule and when to change it.'),
      '12-14': w('共同安排活动时，让孩子决定提醒是否有帮助，不把拒绝记成失败。', 'When arranging an activity, let your child decide whether reminders help. Declining is not a failure.'),
      '15-17': w('共同讨论时商定彼此都接受的提示，也可以约定先独立思考再回应。', 'Agree on mutually acceptable cues in discussion, or take time to think separately before responding.'),
    },
    steps: [w('给出可拒绝的邀请，等待孩子的回答。', 'Offer an invitation that can be declined and wait for an answer.'), w('只约定一种提示，家长也按约定做。', 'Agree on one cue and follow the agreement yourself.'), w('一轮后由双方决定是否调整。', 'After one round, both of you can suggest a change.')],
    fallback: w('提示让人烦躁时先停止提示，改时间再商量。不要持续催促直到得到同意。', 'Stop a cue if it becomes irritating and discuss it another time. Do not keep prompting until they agree.'),
    notice: w('留意孩子能否提出偏好，而不是统计服从了几次。', 'Notice whether your child can express a preference, rather than counting compliance.'),
    templateId: 'turns', task: 'stop',
  },
  {
    stage: 7, title: w('自己核对，也可以求助', 'Check a step and ask for help'),
    purpose: w('给孩子留一次自己查表或提问的机会。求助是可用的方法。', 'Leave room to check a list or ask a question. Asking for help is an available strategy.'),
    invitation: w('“现在到哪一步了？想自己看一眼，还是一起看？”', '“Which step are you on? Would you like to check it yourself or look together?”'),
    examples: {
      '6-8': w('一起看两步小图卡，让孩子指已经做过的一步。', 'Look at a two-step picture card together and invite your child to point to a completed step.'),
      '9-11': w('做完一步后自己勾选，卡住时说清需要哪一部分帮助。', 'Check off a step, then describe which part needs help if stuck.'),
      '12-14': w('在自己的短计划里标出不确定的一步，再选择查资料或请人帮忙。', 'Mark an uncertain step in a short plan, then choose to look something up or ask for help.'),
      '15-17': w('回看个人项目的一小段计划，决定独立继续、寻求帮助或调整范围。', 'Review a small part of a personal project and decide to continue, seek help or change the scope.'),
    },
    steps: [w('先让步骤保持可见。', 'Keep the steps visible.'), w('给一点查看的空间；孩子需要时再一起看。', 'Leave space to check, then look together if help is wanted.'), w('一起确认下一步，允许改小或暂停。', 'Agree on the next step, allowing a smaller step or a pause.')],
    fallback: w('不知道如何提问时，可示范“我卡在这一步”。不以独立完成作为获得帮助的条件。', 'Model “I am stuck on this step” if asking is difficult. Help does not have to be earned by doing it alone.'),
    notice: w('留意用了什么工具、求助是否合适。提醒次数受任务难度与环境影响。', 'Notice tools used and whether help suited the task. Reminder counts depend on task difficulty and surroundings.'),
    templateId: 'steps', task: 'memory',
  },
  {
    stage: 8, title: w('回顾有用的部分，也可以结束', 'Keep what helps, and allow an ending'),
    purpose: w('一起回顾具体尝试，决定保留、调整或停止。结束基础课程不意味着必须继续练。', 'Review specific attempts together and decide what to keep, change or stop. Finishing the foundation does not create an obligation to continue.'),
    invitation: w('“有没有一个办法还想留着？没有也可以。接下来想休息，还是偶尔用一用？”', '“Is there an approach you would like to keep? It is okay if there is not. Would you like a break, or to use one occasionally?”'),
    examples: {
      '6-8': w('请孩子选一个愿意保留的标记或小步骤，也可以把用品收好去休息。', 'Invite your child to keep one marker or small step, or put things away and rest.'),
      '9-11': w('回看一张步骤卡或一个位置标记，由孩子决定以后是否还用。', 'Revisit a step card or place marker and let your child decide whether to use it again.'),
      '12-14': w('由孩子挑一件愿意讨论的尝试，允许保留自己的具体回顾答案。', 'Let your child choose an attempt to discuss and keep their detailed reflection answers to themselves.'),
      '15-17': w('由青少年决定哪些工具留在个人安排里、哪些停止，不要求交一份成长总结。', 'Let your teen decide which tools belong in their plans and which to stop. A progress statement is not required.'),
    },
    steps: [w('选一件具体的尝试来聊，不比较兄弟姐妹或同伴。', 'Discuss one specific attempt without comparisons with siblings or peers.'), w('问工具是否有用，接受不同或不确定的回答。', 'Ask whether a tool helped and accept different or uncertain answers.'), w('一起决定休息、保留一项工具或之后再讨论。', 'Decide together to rest, keep a tool or discuss it another time.')],
    fallback: w('不想回顾就先不聊。不用补做练习来证明进步，也不把游戏成绩当作生活改善的证据。', 'Leave the conversation if it is not wanted. Extra practice is not needed to prove progress, and game scores do not establish everyday improvement.'),
    notice: w('保留具体事实和孩子愿意分享的想法。没有观察到变化，也应如实记录。', 'Keep to concrete observations and thoughts your child wants to share. Record no observed change honestly too.'),
    templateId: 'return', task: 'sustain',
  },
];

export function makeParentGuide(childId: string, ageBand: AgeBand, units: number, collectionActive: boolean): ParentGuide {
  const course = courseUnit(units);
  return {
    childId, ageBand, version: PARENT_GUIDE_VERSION, review: 'unreviewed', content:{hash:null,version:null,review:'unreviewed',state:'legacy'}, collectionActive, course,
    recommended: course.week as GuideStage,
    lessons: lessons.map(({ examples, ...lesson }) => ({ ...lesson, example: examples[ageBand] })),
  };
}
