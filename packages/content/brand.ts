import type { Locale } from '../task-engine/index.ts';

export function pageBrand(locale?: Locale) {
  return locale === 'zh-CN' ? '专注岛' : 'FOCUS ISLAND';
}
