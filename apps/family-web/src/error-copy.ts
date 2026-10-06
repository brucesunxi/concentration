import type { Locale } from '../../../packages/task-engine/index.ts';
import { NetworkUnavailable } from '../../../packages/session-runtime/offline-session.ts';
import { connectionErrorCopy, requestErrorCopy } from '../../../packages/contracts/request-error-copy.ts';
import { withRequestReference } from '../../../packages/contracts/request-reference.ts';
import { RequestError } from './api.ts';

export function familyErrorCopy(error: unknown, locale: Locale): string {
  if (error instanceof NetworkUnavailable) return connectionErrorCopy(locale);
  if (error instanceof RequestError) return withRequestReference(requestErrorCopy(error.code, error.status, locale, error.status >= 500 ? undefined : error.message), error.requestId, locale, error.status, error.code);
  return locale === 'en' ? 'Unable to complete. Please retry.' : '暂时无法完成，请重试。';
}
