import type { FamilyBillingStatus } from '../contracts/family-billing.ts';
import type { Locale } from '../task-engine/index.ts';

export function familyBillingCopy(locale: Locale, status?: FamilyBillingStatus, timeZone?: string) {
  const en = locale === 'en';
  const title = en ? 'Family access' : '家庭使用状态';
  const rights = en ? 'Your saved records, export, and deletion remain available regardless of purchase status.' : '无论购买状态如何，已有记录、导出和删除入口都会保留。';
  if (!status) return { title, heading: en ? 'Unable to confirm access' : '暂时无法确认使用状态',
    detail: en ? 'Your family records are still available. Please retry when connected.' : '家庭记录仍可查看。请在网络恢复后重试。', rights };
  const messages = {
    preview: [en ? 'Test preview' : '测试预览', en ? 'This restricted preview does not charge families or require a purchase. Use fictional child details only.' : '这份受限测试预览不收费，也不需要购买。请仅使用虚构的孩子资料。'],
    free: [en ? 'No verified purchase' : '没有已确认的购买', en ? 'There is no verified purchase on this family account. Activities opened for a free pilot may still be available.' : '此家庭目前没有已确认的购买；已开放的免费试用活动仍可能可以使用。'],
    active: [en ? 'Family access confirmed' : '家庭使用期已确认', en ? 'A verified access period is active for this family.' : '此家庭当前有已确认的使用期。'],
    grace: [en ? 'Temporary access continues' : '宽限期内仍可使用', en ? 'The purchase channel reported a temporary access window. Check that channel for payment details.' : '购买渠道报告了临时宽限期；付款详情请以该渠道为准。'],
    expired: [en ? 'Paid access has ended' : '付费使用期已结束', en ? 'There is no current paid access period. Free pilot activities may still be available.' : '目前没有有效的付费使用期；已开放的免费试用活动仍可能可以使用。'],
    refunded: [en ? 'Purchase was refunded' : '购买已退款', en ? 'The verified purchase no longer grants new paid access. Check the purchase channel for refund details.' : '已核验的购买不再提供新的付费使用权限；退款详情请查看购买渠道。'],
  } as const;
  const [heading, detail] = messages[status.state];
  // Entitlements end at this exact instant; a date alone can imply an extra day.
  const until = status.validUntil ? `${en ? 'Access expires at' : '使用权限将于'} ${new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(new Date(status.validUntil))}${en ? '.' : ' 到期。'}` : null;
  const renewal = status.autoRenew === null ? null : status.autoRenew
    ? en ? 'The channel currently reports automatic renewal as on. Confirm the terms in your purchase account.' : '渠道当前记录为自动续费开启；具体条款请在购买账号中确认。'
    : en ? 'The channel currently reports automatic renewal as off. Your current period remains available until its end.' : '渠道当前记录为自动续费关闭；当前使用期仍可持续至到期。';
  return { title, heading, detail, until, renewal, rights };
}
