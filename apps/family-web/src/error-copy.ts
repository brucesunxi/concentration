import type { Locale } from '../../../packages/task-engine/index.ts';
import { NetworkUnavailable } from '../../../packages/session-runtime/offline-session.ts';
import { RequestError } from './api.ts';

const englishByCode: Record<string, string> = {
  LOGIN_FAILED: 'The family name or password is incorrect, or sign-in is temporarily unavailable.',
  NAME_TAKEN: 'That family name is already in use. Sign in or choose another name.',
  LOCAL_USE_ACK_REQUIRED: 'Please confirm the preview terms before creating a family space.',
  LOCAL_CONFIRMATION_REQUIRED: 'Please confirm the preview terms for this child profile.',
  MARKET_NOT_OPEN: 'This experience is not yet available for this country, age band, language or platform.',
  PROFILE_LIMIT: 'A family can have up to three child profiles.',
  PARENT_REQUIRED: 'Please sign in as a parent to continue.',
  REAUTH_REQUIRED: 'Please enter your parent password again to continue.',
  OWNER_REQUIRED: 'The family creator needs to confirm this action.',
  UNAUTHENTICATED: 'Your sign-in has ended. Please sign in again.',
  MEMBER_PENDING: 'Please wait for the family creator to approve your account.',
  AGE_REVIEW_REQUIRED: 'A parent needs to review this child’s age band before new practice.',
  CONSENT_REVOKED: 'Data collection has stopped for this profile.',
  PRACTICE_PAUSED: 'Your family has paused new practice. You can rest or try a strategy away from the screen.',
  DAILY_LIMIT: 'Today’s practice allowance is complete. Take a break.',
  SESSION_CONFLICT: 'Another device has an unfinished practice. Ask a parent to review it.',
  SESSION_REPLACED: 'A parent ended this practice on the original device. Review its saved record.',
  SESSION_UPLOAD_EXPIRED: 'The time to sync this practice has ended. Ask a parent to review it.',
  ENTITLEMENT_REQUIRED: 'This practice needs an active family plan. Ask a parent to check family access.',
  ENTITLEMENT_UNAVAILABLE: 'Family access cannot be checked right now. Please try again later.',
  UNFINISHED_SESSIONS: 'Please finish or review practice on the old device first.',
  NOT_FOUND: 'This item is no longer available. Refresh the family space.',
  INVALID_REQUEST: 'Please check the information you entered and try again.',
};

export function familyErrorCopy(error: unknown, locale: Locale): string {
  if (error instanceof NetworkUnavailable) return locale === 'en'
    ? 'The family service cannot be reached. Check your connection and try again.'
    : '暂时连接不上家庭服务，请检查网络后重试。';
  if (error instanceof RequestError) {
    if (locale !== 'en') return error.message || '暂时无法完成，请重试。';
    return englishByCode[error.code] ?? (error.status === 401
      ? 'Please sign in again.'
      : error.status === 403
        ? 'This action is not available for this account.'
        : error.status === 409
          ? 'Something has changed. Refresh the family space and try again.'
          : error.status >= 500
            ? 'The family service is temporarily unavailable. Please try again later.'
            : 'Please check the information and try again.');
  }
  return error instanceof Error ? error.message : locale === 'en' ? 'Unable to complete. Please retry.' : '暂时无法完成，请重试。';
}
