import type {Locale} from '../task-engine/index.ts';
import {translate} from '../content/copy.ts';
export function recoveryCopy(locale:Locale,code:string){
 const t=translate(locale);
 const messages:Record<string,string>={
 HANDOVER_CONFLICT:t('旧设备刚刚更新了记录。已重新读取，请查看后再决定。','The original device updated its record. Review the refreshed details before deciding.'),
 REAUTH_REQUIRED:t('请重新验证家长密码，再处理未结束的练习。','Please verify the parent password again before managing this practice.'),
 UNAUTHENTICATED:t('家长登录已失效，请重新登录。','Parent access expired. Please sign in again.'),
 PARENT_REQUIRED:t('需要家长验证后处理。','Parent verification is required.'),
 CONSENT_REVOKED:t('此档案已停止采集，不能再恢复或补传。','Collection has stopped for this profile. Recovery and uploads are disabled.'),
 SESSION_UPLOAD_EXPIRED:t('补传期限已结束。本机记录仍保留，可从家长资料入口导出。','The upload window ended. Local records are preserved and can be exported through parent data tools.'),
 MARKET_SCOPE_CHANGED:t('这次练习的开放范围已改变，不能继续或补传。本机记录仍可从资料入口导出。','This practice is no longer within the approved scope, so it cannot continue or upload. Local records remain available through data export.'),
 SESSION_DEVICE_MISMATCH:t('请使用原来保存这些步骤的设备恢复。','Use the original device that saved these steps to recover them.'),
 SESSION_ENDED:t('这次练习已结束，请刷新查看最新状态。','This practice has ended. Refresh to see its latest state.'),
 REFRESH_REQUIRED:t('结束操作已确认，但最新列表暂未读到，请刷新。','The ending was confirmed, but the refreshed list is unavailable. Please refresh.'),
 };
 return code ? messages[code]??t('暂时无法确认结果。请重试；未确认的结束操作会沿用原请求。','Could not confirm the result. Retry; an unconfirmed ending reuses the same request.') : '';
}
