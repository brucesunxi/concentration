import type {FamilyContentInfo} from './publication.ts';
import type {Locale} from '../task-engine/index.ts';
export function contentLabel(info:FamilyContentInfo,locale:Locale){
  if(info.state==='legacy')return locale==='en'?'Saved with an earlier, unreviewed version.':'使用旧版待审核内容保存的记录。';
  if(info.state!=='available')return locale==='en'?'This content is unavailable. New activities are paused; existing records and answer removal remain available.':'这份内容已停用，暂不能开展新活动。已有记录和撤回分享仍可使用。';
  return info.review==='approved'?(locale==='en'?'Reviewed local preview. Age suitability and everyday benefits still need validation.':'本地审核预览。适龄性和日常效果仍需验证。'):(locale==='en'?'Unreviewed preview for adult development testing.':'待专业审核的预览内容，仅供成人开发验收。');
}
