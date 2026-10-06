import type { Locale } from '../task-engine/index.ts';

const byCode: Record<string, readonly [string, string]> = {
  RESPONSE_UNREADABLE: ['家庭服务的回复暂时无法确认。请先刷新查看最新状态，再决定是否重试。', 'The family service reply could not be confirmed. Refresh to check the latest state before trying again.'],
  EXPORT_SERVER_LIMIT: ['记录超过当前单次导出上限，文件尚未生成。请保留原设备资料，待支持分批导出。', 'The records exceed the current server export limit. No file was created. Keep the original device data until split exports are available.'],
  LOGIN_FAILED: ['家庭名称或密码不正确，或暂时无法登录。', 'The family name or password is incorrect, or sign-in is temporarily unavailable.'],
  NAME_TAKEN: ['家庭名称已存在，请登录或换一个名称。', 'That family name is already in use. Sign in or choose another name.'],
  RATE_LIMITED: ['尝试过于频繁，请稍后再试。', 'Too many attempts. Please wait before trying again.'],
  ACCOUNT_LOCKED: ['密码尝试过于频繁，请在十五分钟后再试。', 'Too many password attempts. Please try again in 15 minutes.'],
  PASSWORD_REJECTED: ['当前密码不正确，请重新输入。', 'The current password is incorrect. Please try again.'],
  PASSWORD_UNCHANGED: ['新密码需要与当前密码不同。', 'Choose a new password that differs from the current one.'],
  FAMILY_NAME_MISMATCH: ['请完整输入家庭名称。', 'Enter the family name exactly as shown.'],
  LOCAL_USE_ACK_REQUIRED: ['请先确认预览范围，再建立家庭空间。', 'Please confirm the preview terms before creating a family space.'],
  LOCAL_CONFIRMATION_REQUIRED: ['请先确认这个档案的预览范围。', 'Please confirm the preview terms for this child profile.'],
  MARKET_NOT_OPEN: ['当前地区、年龄、语言或平台尚未开放此体验。', 'This experience is not yet available for this country, age band, language or platform.'],
  PROFILE_LIMIT: ['一个家庭最多建立三个孩子档案。', 'A family can have up to three child profiles.'],
  PARENT_REQUIRED: ['请先验证家长身份。', 'Please sign in as a parent to continue.'],
  REAUTH_REQUIRED: ['请重新输入家长密码后继续。', 'Please enter your parent password again to continue.'],
  OWNER_REQUIRED: ['这项操作需要家庭创建者确认。', 'The family creator needs to confirm this action.'],
  UNAUTHENTICATED: ['登录已结束，请重新登录。', 'Your sign-in has ended. Please sign in again.'],
  MEMBER_PENDING: ['请等待家庭创建者确认账号。', 'Please wait for the family creator to approve your account.'],
  AGE_REVIEW_REQUIRED: ['请先由家长确认适合的年龄档。', 'A parent needs to review this child’s age band before new practice.'],
  CONSENT_REVOKED: ['这份档案已停止采集。', 'Data collection has stopped for this profile.'],
  PRACTICE_PAUSED: ['家庭已暂停新练习，可以休息或在生活中试试小策略。', 'Your family has paused new practice. You can rest or try a strategy away from the screen.'],
  PRACTICE_PLAN_CHANGED: ['今天的安排已更新，请重新选择练习、查看说明后再决定是否开始。', 'Today’s plan has updated. Choose the practice again, review the instructions, then decide whether to begin.'],
  PRACTICE_REVIEW_REQUIRED: ['请更新应用，并在查看今天的安排后自行选择是否开始。', 'Update the app, review today’s plan, then decide whether to begin.'],
  DAILY_LIMIT: ['今天的练习安排已足够，可以先休息。', 'Today’s practice allowance is complete. Take a break.'],
  SESSION_CONFLICT: ['这份档案在另一台设备有未结束的练习，请家长查看。', 'Another device has an unfinished practice. Ask a parent to review it.'],
  INPUT_CONDITION_CHANGED: ['这台设备有另一种操作方式的未结束练习，请先完成或处理原练习。', 'This device has unfinished practice in another input mode. Finish or review that practice first.'],
  SESSION_TASK_CHANGED: ['这台设备有另一项未结束的练习，请先完成或处理原练习。', 'This device has another unfinished practice. Finish or review it first.'],
  ASSISTIVE_TIMED_UNAVAILABLE: ['读屏操作暂不提供限时看图题，可以选“找一找”或“记一记”。', 'Timed visual tasks are not available in screen reader mode yet. Choose Search or Memory.'],
  SESSION_REPLACED: ['家长已结束原设备上的练习，请查看保存的记录。', 'A parent ended this practice on the original device. Review its saved record.'],
  SESSION_UPLOAD_EXPIRED: ['这次练习的同步期限已结束，请家长查看。', 'The time to sync this practice has ended. Ask a parent to review it.'],
  ENTITLEMENT_REQUIRED: ['这项练习需要有效的家庭权益，请家长查看家庭空间。', 'This practice needs an active family plan. Ask a parent to check family access.'],
  ENTITLEMENT_UNAVAILABLE: ['家庭权益暂时无法确认，请稍后重试。', 'Family access cannot be checked right now. Please try again later.'],
  UNFINISHED_SESSIONS: ['请先结束或处理旧设备上的练习。', 'Please finish or review practice on the old device first.'],
  NOT_FOUND: ['这项内容已不可用，请刷新家庭空间。', 'This item is no longer available. Refresh the family space.'],
  INVALID_REQUEST: ['请检查填写的信息后重试。', 'Please check the information you entered and try again.'],
  ADULT_RIGHTS_REVIEW_REQUIRED: ['成年后的资料权利需要单独核验，当前不能自动转换。', 'Adult data rights need a separate review. This profile cannot be converted automatically.'],
  AGE_GROUP_UNAVAILABLE: ['此记录入口面向青少年。', 'This record view is for teenagers.'],
  AGE_REVIEW_VERSION_CONFLICT: ['档案复核已改变，请重新读取。', 'The age review has changed. Refresh the profile before continuing.'],
  AGE_TRANSITION_NOT_PENDING: ['没有待生效的年龄变更。', 'There is no pending age-band change.'],
  AGE_TRANSITION_PENDING: ['请先处理已提出的年龄变更。', 'Review the pending age-band change first.'],
  CHILD_REQUIRED: ['请在孩子空间里选择。', 'Choose this from the child space.'],
  ENVIRONMENT_TRANSPORT_MISMATCH: ['练习平台与登录方式不一致。', 'This practice platform does not match the sign-in method. Sign in again on this device.'],
  EVENT_CONFLICT: ['同一记录标识对应了不同内容。请保留原设备记录并查看未结束练习。', 'A saved practice event conflicts with another record. Keep the original device data and review the unfinished practice.'],
  FAMILY_CONTENT_CHANGED: ['内容已更新，请重新阅读后再选择。', 'This content has changed. Read the updated version before choosing again.'],
  FAMILY_CONTENT_UPDATE_REQUIRED: ['请更新应用并重新读取当前生活内容。', 'Update the app, then reload the current everyday activity.'],
  GOAL_CLOSED: ['这个生活小目标已经结束。', 'This everyday goal has already ended.'],
  GOAL_CONFLICT: ['生活小目标已更新，请重新读取。', 'This everyday goal has changed. Refresh it before continuing.'],
  GOAL_EXISTS: ['请先处理已有生活小目标。', 'Review the existing everyday goal before starting another.'],
  GUARDIAN_VERIFICATION_REJECTED: ['监护核验未通过或已失效。', 'Guardian verification was declined or has expired.'],
  GUARDIAN_VERIFICATION_UNAVAILABLE: ['监护核验暂不可用，请稍后重试。', 'Guardian verification is temporarily unavailable. Please try again later.'],
  HANDOVER_CONFLICT: ['练习记录已更新，请重新查看后确认。', 'This practice has changed. Review its latest state before confirming the handover.'],
  IDEMPOTENCY_CONFLICT: ['重复请求的内容不同，请刷新后确认。', 'This retry differs from the original request. Refresh before trying again.'],
  INVALID_HISTORY_CURSOR: ['翻页位置已不可用，请重新读取最新记录。', 'The history position is no longer valid. Reload the latest records.'],
  INVALID_IDEMPOTENCY_KEY: ['请求标识无效，请更新应用后重试。', 'The request identifier is invalid. Update the app and try again.'],
  INVALID_LIFE_HISTORY_CURSOR: ['历史记录位置无效，请重新读取最新记录。', 'The everyday-goal history position is invalid. Reload the latest records.'],
  INVALID_PRECONDITION: ['记录版本无效，请重新读取后再试。', 'The record version is invalid. Reload it before trying again.'],
  INVALID_REPORT_WEEK: ['请选择最近 52 周内的周一，不能选择未来的一周。', 'Choose a Monday within the past 52 weeks, not a future week.'],
  INVALID_VERSION: ['版本无效，请重新读取当前内容。', 'The version is invalid. Reload the current information.'],
  INVITE_ACCEPTED: ['邀请已接受，请在家长列表中处理该成员。', 'This invitation has been accepted. Manage the member from the parent list.'],
  INVITE_ALREADY_CREATED: ['这份邀请已创建，请查看邀请列表。邀请码只显示一次。', 'This invitation already exists. Check the invitation list; its code is shown only once.'],
  INVITE_UNAVAILABLE: ['邀请不可用，可能已过期、取消或接受。', 'This invitation is unavailable. It may have expired, been cancelled or already been accepted.'],
  LEGACY_SESSION: ['旧版练习需在原设备结束。', 'This older practice must be finished on its original device.'],
  LIMIT_ABOVE_AGE_MAXIMUM: ['不能超过这一年龄段的上限。', 'This exceeds the practice limit for the selected age band.'],
  LIMIT_DAY_CHANGED: ['家庭日期已改变，请重新读取生效日期。', 'The family day has changed. Reload the date when the new plan will take effect.'],
  LIMIT_VERSION_CONFLICT: ['练习安排已改变，请重新读取后确认。', 'The practice plan has changed. Reload it before confirming.'],
  MARKET_SCOPE_CHANGED: ['这次练习的开放范围已改变，请到家长空间查看记录。', 'Availability for this practice has changed. Review the saved record in the parent space.'],
  MEMBER_CHILDREN_UNAVAILABLE: ['请重新选择仍允许练习的孩子。', 'Select children who are still eligible for practice.'],
  MEMBER_LIMIT: ['一个家庭最多有四位家长，待接受的邀请也占一个名额。', 'A family can have up to four parents. Pending invitations also count toward this limit.'],
  MEMBER_NAME_TAKEN: ['此家庭已使用这个家长登录名，请换一个。', 'This parent sign-in name is already used in the family. Choose another.'],
  MEMBER_STATE_CONFLICT: ['家长成员状态已改变，请重新读取。', 'This parent member’s status has changed. Reload the parent list.'],
  MEMBER_VERSION_CONFLICT: ['家长权限已更新，请重新读取后确认。', 'Parent access has changed. Reload it before confirming.'],
  MISSING_END: ['练习尚未保存结束事件，请在原设备重试。', 'The practice ending was not saved. Retry from the original device.'],
  OWNER_PROTECTED: ['家庭创建者不能通过此操作移除或替换。', 'The family creator cannot be removed or replaced with this action.'],
  PRECONDITION_REQUIRED: ['请先读取当前记录版本。', 'Reload the current record before making this change.'],
  REFLECTION_NOT_SHARED: ['这份回顾没有可撤回的答案。', 'There are no shared answers to remove from this reflection.'],
  REFLECTION_WITHDRAWN: ['答案已撤回，旧的分享请求不能再次提交。', 'These answers were removed. An older sharing request cannot restore them.'],
  REGISTRATION_PLATFORM_MISMATCH: ['注册平台与客户端不一致。', 'The registration platform does not match this app.'],
  REGISTRATION_PLATFORM_REQUIRED: ['应用缺少设备平台信息，请更新后重试。', 'The app is missing device platform information. Update it and try again.'],
  REPORT_RANGE_TOO_LARGE: ['这个时间段的记录量超过同步回顾上限，请先导出资料查看。', 'There are too many records for a live review of this period. Export the records to inspect them.'],
  SESSION_DEVICE_MISMATCH: ['这次练习属于原先的设备，请在原设备恢复。', 'This practice belongs to the original device. Resume it there.'],
  SESSION_ENDED: ['这次练习已结束。', 'This practice has already ended.'],
  SHARING_CHOICE_REQUIRED: ['请更新应用，并明确选择是否分享本次回顾。', 'Update the app and choose whether to share this reflection.'],
  VERIFICATION_REPLAYED: ['这份核验凭证已经使用，请重新核验。', 'This verification result has already been used. Start verification again.'],
  VERIFICATION_TOKEN_INVALID: ['核验凭证无效，请重新核验。', 'The verification result is invalid. Start verification again.'],
  VERSION_REQUIRED: ['请先读取当前状态。', 'Reload the current information before continuing.'],
};

export function connectionErrorCopy(locale: Locale): string {
  return locale === 'en'
    ? 'The family service cannot be reached. Check your connection and try again.'
    : '暂时连接不上家庭服务，请检查网络后重试。';
}

export function requestErrorCopy(code: string, status: number, locale: Locale, chineseDetail?: string): string {
  if (locale === 'zh-CN' && chineseDetail && /[\u3400-\u9fff]/u.test(chineseDetail)) return chineseDetail;
  const known = byCode[code];
  if (known) return known[locale === 'en' ? 1 : 0];
  const fallback = status === 429
    ? ['尝试过于频繁，请稍后再试。', 'Too many attempts. Please wait before trying again.']
    : status === 401
    ? ['请重新登录。', 'Please sign in again.']
    : status === 403
      ? ['当前账号不能进行这项操作。', 'This action is not available for this account.']
      : status === 409
        ? ['家庭状态已改变，请刷新后重试。', 'Something has changed. Refresh the family space and try again.']
        : status >= 500
          ? ['家庭服务暂时无法使用，请稍后重试。', 'The family service is temporarily unavailable. Please try again later.']
          : ['请检查填写的信息后重试。', 'Please check the information and try again.'];
  return fallback[locale === 'en' ? 1 : 0];
}
