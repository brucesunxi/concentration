import type { Locale } from '../task-engine/index.ts';

/** English uses the singular at 1. Chinese keeps the same classifier for every count. */
export function countCopy(locale: Locale, n: number, enOne: string, enMany: string, zh: string): string {
  if (locale === 'zh-CN') return `${n} ${zh}`;
  return `${n} ${n === 1 ? enOne : enMany}`;
}
