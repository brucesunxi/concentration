import type { Locale } from '../task-engine/index.ts';

/** English marker that a Play internal bundle must contain. It is not a secret. */
export const HOSTED_TEST_SERVICE_MARKER = 'designated test family service';

export function mobilePreviewStatus(locale: Locale, hosted: boolean): string {
  if (locale === 'en') {
    return hosted
      ? 'Hosted internal preview · Adults using fictional details only. Not an open family service.'
      : 'Local development preview · Adults testing with fictional profiles only';
  }
  return hosted
    ? '线上内部测试预览 · 仅供成人使用虚构资料。不是已开放的家庭服务。'
    : '本地开发预览 · 仅供成人使用虚构资料验收';
}

export function mobileHostedServiceNotice(locale: Locale): string {
  return locale === 'en'
    ? `Preparation and sync need the ${HOSTED_TEST_SERVICE_MARKER}. This is not a standalone offline app.`
    : '准备和同步需要指定的测试家庭服务，不是可以离线独立使用的正式应用。';
}

export function mobileCreateAcknowledgement(locale: Locale, hosted: boolean): string {
  if (locale === 'en') {
    return hosted
      ? `I will use fictional test details only. I understand records are saved in the ${HOSTED_TEST_SERVICE_MARKER} and this is not open to real families.`
      : 'I will use fictional details for local testing.';
  }
  return hosted
    ? '我会只用虚构资料测试，知道记录会保存到指定的测试家庭服务；这不是正式开放给真实家庭的产品。'
    : '我会使用虚构资料进行本地测试。';
}

export function mobileProfileAcknowledgement(locale: Locale, hosted: boolean): string {
  if (locale === 'en') {
    return hosted
      ? `I will use a fictional nickname only and understand new practice records are saved in the ${HOSTED_TEST_SERVICE_MARKER}.`
      : 'This is a fictional profile for adult development testing.';
  }
  return hosted
    ? '我会只用虚构昵称测试，知道新练习记录保存在指定的测试家庭服务。'
    : '这是用于成人开发验收的虚构档案。';
}

export function mobileAgeReviewAcknowledgement(locale: Locale, hosted: boolean): string {
  if (locale === 'en') {
    return hosted
      ? `I will use fictional details to test the new age band, understand that new records are saved in the ${HOSTED_TEST_SERVICE_MARKER}, and let the child choose each time whether to join.`
      : 'I agree to save local test records for the new age band on this device and let my child choose each time whether to take part.';
  }
  return hosted
    ? '我会只用虚构资料继续测试新年龄档，知道新记录保存在指定的测试家庭服务，并会让孩子每次自行选择是否参加。'
    : '我同意在这台设备继续保存新年龄档的本地测试记录，并会让孩子每次自行选择是否参加。';
}
