import type { Locale } from '../task-engine/index.ts';

/** Only the server-generated request ID is safe to show as a support reference. */
export function validRequestReference(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

export function withRequestReference(message: string, reference: string | null, locale: Locale, status: number, code: string): string {
  const safeReference = validRequestReference(reference);
  if (!safeReference || (status < 500 && code !== 'RESPONSE_UNREADABLE')) return message;
  return locale === 'en' ? `${message} Reference: ${safeReference}` : `${message} 参考编号：${safeReference}`;
}
