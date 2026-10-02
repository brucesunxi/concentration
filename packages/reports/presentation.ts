import { taskContent, translate } from '../content/copy.ts';
import type { Locale } from '../task-engine/index.ts';
import type { ComparisonStatus, LifeStats, WeekStats, WeeklyReport } from './weekly.ts';

export interface ReviewItem { key: string; title: string; lines: string[]; details?: string[] }
export function weeklyPresentation(report: WeeklyReport, locale: Locale) {
  const t = translate(locale);
  const count = (value: number, singular: string, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
  const title = (task: Parameters<typeof taskContent>[0]) => taskContent(task, locale, '9-11').skill;
  const statuses: Record<ComparisonStatus, string> = {
    'available': t('以下只描述两周相同条件下的任务记录，不代表能力或生活成效。', 'This describes task records under the same conditions, not ability or everyday outcomes.'),
    'week-in-progress': t('这一周还在进行，暂不计算两周差值。', 'This week is still in progress; no week-to-week difference is calculated.'),
    'missing-metadata': t('缺少可比较的版本或设备资料，这组记录单独保留。', 'Comparable version or device details are missing. These records are kept separately.'),
    'incomplete-data': t('两周内仍有未确认或条件不一致的记录，暂不计算差值。', 'These weeks include unconfirmed records or inconsistent conditions; no difference is calculated.'),
    'interrupted-or-assisted': t('含使用帮助、中断、排除或提前结束的尝试，保留全部记录，暂不计算差值。', 'Some attempts included help, interruptions, exclusions or early stops. All records remain visible; no difference is calculated.'),
    'insufficient-records': t('相同条件的记录还少，或其中一周没有记录。按原有节奏练习即可，无需为了填满回顾增加时长。', 'There are too few comparable records, or one week has none. Keep your usual pace; there is no need to add practice time for this review.'),
    'assistive-mode-unvalidated': t('读屏操作记录单独保留；目前没有经过验证的比较规则，不计算两周差值或自动调难度。', 'Screen reader records are kept separately. Comparison rules are not validated yet, so no week-to-week difference or automatic difficulty change is calculated.'),
  };
  const stats = (value: WeekStats, label: string, timed: boolean, assistive: boolean) => [
    t(`${label}：完整 ${value.completed} 次，提前结束 ${value.stoppedEarly} 次`, `${label}: ${value.completed} completed, ${value.stoppedEarly} stopped early`),
    assistive ? t(`读屏方式完成正式步骤 ${value.metrics.trials + value.metrics.assisted} 个，不计入普通触控表现。`, `${count(value.metrics.trials + value.metrics.assisted, 'formal screen reader step')}; excluded from standard touch performance.`) : value.metrics.trials ? t(`独立有效步骤 ${value.metrics.trials} 个，其中正确 ${value.metrics.correct} 个`, `${count(value.metrics.trials, 'valid independent step')}; ${value.metrics.correct} correct`) : t('尚无独立有效步骤', 'No valid independent steps'),
    ...(timed ? [t(`目标命中 ${value.metrics.hits}/${value.metrics.targets}；非目标正确等待 ${value.metrics.distractors - value.metrics.falseAlarms}/${value.metrics.distractors}`, `Target hits ${value.metrics.hits}/${value.metrics.targets}; correct waits ${value.metrics.distractors - value.metrics.falseAlarms}/${value.metrics.distractors}`)] : []),
    t(`帮助步骤 ${value.metrics.assisted} 个；中断 ${value.interruptions} 次；排除/重做记录 ${value.excluded} 条（可与中断重合）`, `${count(value.metrics.assisted, 'assisted step')}; ${count(value.interruptions, 'interruption')}; ${count(value.excluded, 'excluded/repeated attempt')} (may overlap interruptions)`),
  ];
  const devices = { desktop: t('电脑', 'Computer'), tablet: t('平板', 'Tablet'), phone: t('手机', 'Phone') };
  const inputs = { pointer: t('指针点击', 'Pointer'), touch: t('触摸', 'Touch'), keyboard: t('键盘', 'Keyboard'), assistive: t('读屏操作', 'Screen reader') };
  const contexts: Record<string, string> = { packing: t('准备物品', 'Getting things ready'), tidying: t('整理小空间', 'Tidying a space'), reading: t('短段阅读', 'A little reading'), project: t('个人小项目', 'A small project') };
  const life = (value: LifeStats, label: string) => value.count ? t(`${label}：${value.count} 条观察，其中孩子自选 ${value.childChosen} 条；提醒次数范围 ${value.minReminders}–${value.maxReminders}。`, `${label}: ${count(value.count, 'observation')}, ${value.childChosen} chosen by the child; reminders ranged from ${value.minReminders} to ${value.maxReminders}.`) : t(`${label}：没有观察记录。`, `${label}: no observations recorded.`);
  const current = t('所选周', 'Selected week'), previous = t('前一周', 'Previous week');
  const conditionItems = report.groups.map<ReviewItem>(group => {
    const timed = ['stop', 'sustain'].includes(group.task), change = group.comparison.changePoints;
    const assistive = group.environment?.input === 'assistive';
    const lines = [...stats(group.current, current, timed, assistive), ...stats(group.previous, previous, timed, assistive), statuses[group.comparison.status]];
    if (change !== null) lines.push(t(
      `${timed ? '两类反应平均正确率' : '独立步骤正确率'}差值 ${change > 0 ? '+' : ''}${change} 个百分点，仅为描述性差值。`,
      `${timed ? 'Balanced response accuracy' : 'Independent-step accuracy'} differs by ${change > 0 ? '+' : ''}${change} percentage points; a descriptive difference only.`,
    ));
    return {
      key: group.key, title: `${title(group.task)} · ${t(`等级 ${group.level}`, `Level ${group.level}`)}`, lines,
      details: [
        t(`年龄段 ${group.ageBand}；练习语言 ${group.locale}`, `Age band ${group.ageBand}; practice language ${group.locale}`),
        group.environment ? `${group.environment.platform} · ${devices[group.environment.deviceClass]} · ${inputs[group.environment.input]}` : t('设备条件未记录', 'Device conditions were not recorded'),
        t(`任务规则 ${group.engineVersion}；材料版本 ${group.content?.version ?? '—'}`, `Task protocol ${group.engineVersion}; content version ${group.content?.version ?? '—'}`),
        group.windowPolicy ? t(`单次期限最多 ${group.windowPolicy.maxElapsedMs / 60000} 分钟；每 ${group.windowPolicy.checkInAfterMs / 60000} 分钟后在间隙询问休息。`, `Practice window up to ${group.windowPolicy.maxElapsedMs / 60000} minutes; a break check-in at a safe point after each ${group.windowPolicy.checkInAfterMs / 60000} minutes.`) : t('沿用历史继续期限；未启用本版休息询问。', 'Historical continuation window; this break check-in rule was not enabled.'),
      ],
    };
  });
  return {
    heading: t('一起回顾这一周', 'Look back on the week together'),
    range: `${report.range.start} – ${report.range.end}`,
    subtitle: t(`按家庭时区 ${report.timezone} 和服务确认日期归周；${report.range.inProgress ? '本周尚未结束' : '这是已结束的一周'}。仅包含已确认结果，离线补传可能归入较晚的一周。`, `Grouped by family timezone (${report.timezone}) and server confirmation date. ${report.range.inProgress ? 'This week is still in progress.' : 'This week has ended.'} Only confirmed results are included; offline uploads may appear in a later week.`),
    coverage: t(`完整练习 ${report.coverage.completed} 次，提前结束 ${report.coverage.stoppedEarly} 次。所选周开始但尚无确认结果的会话 ${report.coverage.unfinalized} 次，前一周 ${report.coverage.previousUnfinalized} 次；两周内条件资料不一致的已确认记录 ${report.coverage.unclassified} 条。`, `${report.coverage.completed} completed practices; ${report.coverage.stoppedEarly} stopped early. Unconfirmed sessions started in the selected week: ${report.coverage.unfinalized}; in the previous week: ${report.coverage.previousUnfinalized}. Across both weeks, ${report.coverage.unclassified} confirmed records have inconsistent conditions.`),
    missing: t(`已有日期中，${report.coverage.daysWithoutConfirmedPractice} 天暂无已确认练习。这不代表孩子没有尝试；本机未同步记录和其他离线设备不包含在内。`, `${report.coverage.daysWithoutConfirmedPractice} elapsed days have no confirmed practice. This does not mean no attempt was made; unsynced records and other offline devices are not included.`) + ((report.coverage.historyOnly ?? 0) + (report.coverage.previousHistoryOnly ?? 0) ? t(`  本周另有 ${report.coverage.historyOnly ?? 0} 份、前一周 ${report.coverage.previousHistoryOnly ?? 0} 份换设备前的独立记录；不纳入比较，也不据此计算变化。`, ` ${report.coverage.historyOnly ?? 0} current-week and ${report.coverage.previousHistoryOnly ?? 0} previous-week device records are kept separately. They are excluded, and no change is calculated.`) : ''),
    days: report.days.map(day => ({ date: day.date.slice(5), label: day.future ? t('尚未到来', 'Upcoming') : t(`已确认练习记录 ${day.finalized} 条 · 观察 ${day.observations} 条`, `${count(day.finalized, 'confirmed practice record')} · ${count(day.observations, 'observation')}`) })),
    sections: [
      { key: 'strategies', title: t('1 · 练过什么策略', '1 · Strategies tried'), intro: t('从具体尝试开始聊，允许孩子说「今天不想谈」。', 'Start with a specific attempt. Let your child choose not to talk today.'), empty: t('这一周还没有已确认的策略练习记录。', 'There are no confirmed strategy practices for this week.'), items: report.strategies.map(value => ({ key: value.task, title: title(value.task), lines: [t(`尝试 ${value.sessions} 次；独立有效步骤 ${value.independentSteps} 个，帮助步骤 ${value.assistedSteps} 个。`, `${count(value.sessions, 'attempt')}; ${count(value.independentSteps, 'valid independent step')} and ${count(value.assistedSteps, 'assisted step')}.`), ...(value.assistiveSteps ? [t(`另有读屏方式完成的正式步骤 ${value.assistiveSteps} 个，单独保留。`, `${count(value.assistiveSteps, 'formal screen reader step')} kept separately.`)] : []), ...(value.independentSteps + value.assistedSteps + value.assistiveSteps === 0 ? [t('这些记录尚无完成的正式步骤；示范不计入表现。', 'These records contain no completed formal steps; examples do not count toward results.')] : [])] })) as ReviewItem[] },
      { key: 'conditions', title: t('2 · 相同条件里的任务记录', '2 · Task records under the same conditions'), intro: t(`前一周范围：${report.range.previousStart} – ${report.range.previousEnd}。不同任务、等级、语言、设备及材料版本分开看。`, `Previous week: ${report.range.previousStart} – ${report.range.previousEnd}. Tasks, levels, languages, devices and content versions are kept separate.`), empty: t('这两周暂无可列出的条件组。没有数据时不生成趋势。', 'No condition groups are available for these two weeks. No trend is generated without records.'), items: conditionItems },
      { key: 'life', title: t('3 · 生活中的具体尝试', '3 · Specific everyday attempts'), intro: t('按观察的保存日期整理。活动难度和时长没有统一，提醒次数不能直接当作能力变化。可以问：「哪一步有帮助？下次想保留什么？」', 'Grouped by the date the observation was saved. Activity difficulty and duration vary, so reminder counts are not an ability measure. Ask: “What helped? What would you like to keep next time?”'), empty: t('暂无生活观察。可以从孩子愿意分享的一件小事开始。', 'No everyday observations yet. Start with one small experience your child wants to share.'), items: report.life.map(group => ({ key: group.task + ':' + group.context, title: `${contexts[group.context] ?? t('其他活动', 'Other activity')} · ${title(group.task)}`, lines: [life(group.current, current), life(group.previous, previous)] })) as ReviewItem[] },
    ],
  };
}
