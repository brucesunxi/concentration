import type { Locale } from '../task-engine/index.ts';
import type { Words } from './model.ts';
import type { ParentGuide } from './parent-guide-model.ts';
const w = (zh: string, en: string): Words => ({ 'zh-CN': zh, en });
export const guideCopy = {
  title: w('家长陪伴小课', 'A guide for parents'),
  subtitle: w('每次读一小节，把一种支持方式带进生活。', 'Read a short section and try one way to support your child in everyday life.'),
  preview: w('待专业审核的内容预览，仅供成人开发验收。尚未验证适龄性或日常效果。', 'Unreviewed content preview for adult development testing. Age suitability and everyday benefits have not been validated.'),
  pace: w('阶段按推荐练习进度对应，不按日历催进度。章节可自由阅读，不记录阅读次数，也不改变孩子成绩。', 'Stages follow recommended practice progress, without a calendar deadline. Read any section. Reading is not tracked and does not change your child’s scores.'),
  refresh: w('刷新课程进度', 'Refresh course progress'),
  recommended: w('回到当前建议', 'Return to the current suggestion'),
  chapters: w('选择一个陪伴主题', 'Choose a topic'),
  purpose: w('这一节做什么', 'What this section is for'),
  invitation: w('可以这样邀请', 'An invitation you can try'),
  example: w('适合这个年龄段的尝试', 'An example for this age group'),
  steps: w('离开屏幕后，试一小步', 'One small step away from the screen'),
  fallback: w('不顺利时，退一小步', 'When it is difficult, make it smaller'),
  notice: w('家长可以留意什么', 'What a parent can notice'),
  life: w('打开生活建议，一起商量', 'Open an everyday suggestion to discuss'),
  lifeHint: w('打开后可以修改，确认前不会保存。家长提出的建议仍需孩子选择是否接受。若已有目标，先查看它。', 'You can change the suggestion before saving. Your child still chooses whether to accept it. If a goal already exists, review it first.'),
  beforeStart: w('先商量好，再选择一件生活小事。所有章节都可以随时查看。', 'Talk together first, then choose an everyday activity. All sections are available at any time.'),
  stopped: w('此档案已停止采集。仍可阅读陪伴内容；不能新增生活记录。', 'Collection has stopped for this profile. You can still read the guide; new everyday records cannot be added.'),
  loading: w('正在读取陪伴内容…', 'Loading the parent guide…'),
  selectedSuggestion: w('已选中一个相关的生活建议，可以更换或离开。由你确认前，它还不是家庭目标。', 'A related everyday idea is selected. You can change it or leave. It is not a saved family goal until you confirm.'),
};
export function guideProgress(data: ParentGuide, locale: Locale) {
  return locale === 'en'
    ? data.course.complete ? 'Foundation finished. Revisit what helps, or take a break.' : `Stage ${data.course.week} of 8 · ${data.course.weekDone} of 3 recommended practices completed`
    : data.course.complete ? '基础课程已结束。可以回看有用的方法，也可以休息。' : `第 ${data.course.week} / 8 阶段 · 本阶段推荐练习已完成 ${data.course.weekDone} / 3 次`;
}
export function guideError(code: string, locale: Locale) {
  if (!code) return '';
  const copy = ['UNAUTHENTICATED', 'PARENT_REQUIRED', 'ACCESS_CHANGED'].includes(code)
    ? w('家长访问状态已变化，请重新验证家长身份。', 'Parent access has changed. Please sign in again.')
    : code === 'NOT_FOUND' ? w('这份档案已不可用，请返回家庭空间。', 'This profile is unavailable. Return to your family space.')
    : ['FAMILY_CONTENT_RECALLED','FAMILY_CONTENT_EXPIRED'].includes(code) ? w('这份陪伴内容已停用，暂时无法阅读。请稍后刷新。','This guide is unavailable. Refresh after a replacement is published.')
    : code === 'GUIDE_UPDATE_REQUIRED' ? w('陪伴内容版本不匹配，请关闭页面并更新后重试。', 'The guide version is incompatible. Close this view and update before retrying.')
    : w('暂时无法读取陪伴内容。请联网后重试。', 'The guide is unavailable. Reconnect and try again.');
  return copy[locale];
}
