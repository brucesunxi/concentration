import type { Locale } from '../task-engine/index.ts';

export type CollectionStatus =
  | 'local-preview-enabled'
  | 'local-preview-required'
  | 'guardian-verified'
  | 'guardian-verification-required'
  | 'collection-withdrawn';

const copy: Record<CollectionStatus, Record<Locale, { short: string; detail: string }>> = {
  'local-preview-enabled': {
    'zh-CN': { short: '开发预览可体验', detail: '开发预览确认有效。它不等于可验证的监护人许可；当前版本尚未开放真实家庭使用。' },
    en: { short: 'Development preview enabled', detail: 'Development preview confirmation is active. It is not verified guardian permission; this version is not open to real families.' },
  },
  'local-preview-required': {
    'zh-CN': { short: '开发预览未开放', detail: '开发预览确认缺失或失效。新练习和新观察已暂停，已有记录仍可由家长导出或删除。' },
    en: { short: 'Development preview unavailable', detail: 'Development preview confirmation is missing or invalid. New practice and observations are paused; a parent can still export or delete existing records.' },
  },
  'guardian-verified': {
    'zh-CN': { short: '监护核验有效', detail: '当前孩子、用途和开放范围的监护核验仍在有效期内。家长可以随时停止新数据采集。' },
    en: { short: 'Guardian verification active', detail: 'Guardian verification for this child, purpose and release scope is active. A parent can stop new data collection at any time.' },
  },
  'guardian-verification-required': {
    'zh-CN': { short: '需要监护核验', detail: '开始练习前需要完成适用的监护核验。当前版本尚未开放核验入口，因此不会采集新的练习数据。' },
    en: { short: 'Guardian verification needed', detail: 'Guardian verification is required before practice. This version has no verification entry point, so it will not collect new practice data.' },
  },
  'collection-withdrawn': {
    'zh-CN': { short: '已停止采集', detail: '此档案已停止新数据采集。已有记录仍可由家长导出或删除。' },
    en: { short: 'Collection stopped', detail: 'New data collection has stopped for this profile. A parent can still export or delete existing records.' },
  },
};

export function collectionStatusCopy(status: CollectionStatus | undefined, locale: Locale) {
  const current = status && copy[status];
  return current?.[locale] ?? (locale === 'zh-CN'
    ? { short: '状态暂不可用', detail: '无法确认此档案目前是否允许采集。请更新家庭服务并重试；在确认前不要开始新练习。' }
    : { short: 'Status unavailable', detail: 'Collection permission cannot be confirmed for this profile. Update the family service and try again before starting new practice.' });
}

export function collectionStatusAllowsPractice(status: CollectionStatus | undefined, consentActive: boolean) {
  return consentActive && (status === 'local-preview-enabled' || status === 'guardian-verified');
}
