import type { Locale } from '../task-engine/index.ts';
import type { PracticeLimits } from '../contracts/practice-limits.ts';
export function limitCopy(locale: Locale) {
  const t = (zh: string, en: string) => locale === 'zh-CN' ? zh : en;
  return {
    title: t('练习与休息', 'Practice & rest'), intro: t('练习可以短一点，也可以今天先休息。', 'Keep practice short. Taking a day off is fine too.'),
    today: t('今天的安排', 'Today’s plan'), maximum: t('每日最多', 'Daily maximum'), minutes: (n: number) => t(`${n} 分钟`, `${n} ${n === 1 ? 'minute' : 'minutes'}`), paused: t('暂停新练习', 'Pause new practice'),
    lastKnown: t('上次确认的安排', 'Last confirmed plan'), stale: t('暂时无法确认最新安排。未保存的选择已保留，请联网后更新状态，再核对日期并保存。', 'The latest plan could not be confirmed. Your unsaved choice is kept. Reconnect and refresh, then check the date before saving.'),
    date: (day: string, zone: string) => t(`家庭日期 ${day} · ${zone}`, `Family date ${day} · ${zone}`),
    pending: (data: PracticeLimits) => data.next ? t(`${data.next.day} 起：${data.next.minutes ? `每日最多 ${data.next.minutes} 分钟` : '暂停新练习'}。`, `From ${data.next.day}: ${data.next.minutes ? `up to ${data.next.minutes} ${data.next.minutes === 1 ? 'minute' : 'minutes'} daily` : 'new practice paused'}.`) : t('没有待生效的修改。', 'No upcoming change.'),
    status: (status: PracticeLimits['status']) => ({ available: t('还有练习时间，不用把时间用满。', 'Practice time is available. There is no need to use it all.'), reserved: t('有尚未确认结束的练习，时间仍为它保留。请先恢复或处理记录，再安排新的练习。', 'Time is held for unfinished or unconfirmed practice. Recover or resolve its record before arranging more.'), 'daily-limit': t('今天的安排已经足够。可以休息，或在生活中试试小策略。', 'Today’s allowance is complete. Rest, or try a strategy in everyday life.'), paused: t('家庭已暂停新练习。生活小目标和已有记录仍可使用。', 'Your family has paused new practice. Everyday goals and existing records remain available.'), 'collection-stopped': t('这份档案已停止采集，不能准备新的练习。', 'Collection has stopped for this profile. New practice is unavailable.') }[status]),
    scope: t('这里只计算任务中的有效练习时间，不包括说明、暂停和其他页面；它不是设备总屏幕时长。', 'This counts active task time, excluding instructions, pauses and other pages. It is not total device screen time.'),
    confirmed: t('已确认的练习用时', 'Confirmed practice time'), reserved: t('尚未结清的预留时间', 'Time held for unconfirmed practice'), remaining: t('今天可再安排', 'Available for more practice today'),
    duration: (ms: number) => { const sec = Math.ceil(ms / 1000); return t(`${Math.floor(sec / 60)} 分 ${sec % 60} 秒`, `${Math.floor(sec / 60)} min ${sec % 60} sec`); },
    edit: t('调整后续安排', 'Adjust future practice'), ceiling: (n: number) => t(`可选择暂停或 1–${n} 分钟。当前年龄段的开发上限为 ${n} 分钟，不能通过多次开启增加。`, `Choose a pause or 1–${n} minutes. The preview ceiling for this age band is ${n} minutes; reopening practice does not add time.`),
    timing: (day: string) => t(`修改从 ${day} 起生效。今天已准备的练习仍按原上限运行；孩子随时可以自行结束。`, `Changes take effect on ${day}. Practice prepared today keeps its original limit; your child can stop at any time.`),
    choice: t('新的每日上限', 'New daily maximum'), ack: t('我已了解生效日期，并会和孩子商量安排。', 'I understand the effective date and will discuss the plan with my child.'),
    save: t('保存后续安排', 'Save future plan'), saved: t('安排已保存，请核对生效日期。', 'Plan saved. Check its effective date.'), reload: t('更新今天的状态', 'Refresh today’s status'), loading: t('正在读取安排…', 'Loading your plan…'), busy: t('正在保存…', 'Saving…'),
    login: t('重新验证家长身份', 'Verify parent access'), back: t('回到家庭空间', 'Back to family space'), life: t('看看生活小目标', 'Explore everyday goals'), recovery: t('查看未结束练习', 'View unfinished practice'),
    child: t('这是家里商量的安排；想调整时，可以和家长一起讨论。', 'This is your family’s plan. Talk with a parent if you would like to change it.'),
    preview: t('这些上限是本地开发设置，尚未经过适龄使用验证，不是治疗剂量。', 'These preview limits await age-appropriate usability review; they are not a treatment dose.'),
    error: (code: string) => ({ LIMIT_VERSION_CONFLICT: t('另一处已修改安排。请重新读取，再决定是否更改。', 'The plan changed elsewhere. Refresh it before making another change.'), LIMIT_DAY_CHANGED: t('家庭日期已改变，请重新读取生效日期。', 'The family date changed. Refresh to check the effective date.'), RESULT_UNCONFIRMED: t('还不能确认是否保存成功。请读取最新安排，不要重复提交旧设置。', 'Saving could not be confirmed. Refresh the current plan before submitting again.'), REAUTH_REQUIRED: t('请先重新验证家长身份。', 'Verify parent access again first.'), CONSENT_REVOKED: t('这份档案已停止采集，请重新读取状态。', 'Collection has stopped. Refresh the profile’s status.'), LOAD_FAILED: t('暂时无法读取安排，请联网重试。', 'Unable to load the plan. Reconnect and retry.') }[code] ?? t('暂时无法完成，请重新读取或验证家长身份。', 'Unable to continue. Refresh the plan or verify parent access.')),
  };
}
