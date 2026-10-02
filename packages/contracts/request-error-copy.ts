import type { Locale } from '../task-engine/index.ts';

const byCode: Record<string, readonly [string, string]> = {
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
