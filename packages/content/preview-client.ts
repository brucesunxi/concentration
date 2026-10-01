import {canonical,hashObject,packSchema} from './index.ts';
import {createPlan,DAILY_LIMIT} from '../task-engine/index.ts';
import type {CandidatePreview} from './preview.ts';
/** Rebuild the trial plan locally: a preview must execute the actual shared protocol. */
export async function verifyCandidatePreview(snapshot:CandidatePreview){
  const pack=packSchema.parse(snapshot.pack),plan=snapshot.plan;
  if(!/^[a-f0-9-]{36}$/.test(snapshot.id)||snapshot.id!==plan.id||snapshot.budgetMs!==DAILY_LIMIT[pack.ageBand]||!Number.isFinite(Date.parse(snapshot.expiresAt)))throw new Error('Invalid preview scope');
  if(await hashObject(pack)!==snapshot.packHash||await hashObject(plan)!==snapshot.planHash)throw new Error('Preview hash mismatch');
  if(plan.task!==pack.task||plan.ageBand!==pack.ageBand||plan.locale!==pack.locale||plan.version!==pack.engineVersion||plan.policyVersion!==pack.policyVersion||plan.content?.id!==pack.id||plan.content.version!==pack.version||plan.content.sha256!==snapshot.packHash||plan.environment?.platform!=='web')throw new Error('Preview plan does not match candidate');
  const regenerated=createPlan({id:plan.id,task:pack.task,ageBand:pack.ageBand,locale:pack.locale,level:plan.level,seed:plan.seed,environment:plan.environment,content:plan.content});
  if(canonical(regenerated)!==canonical(plan))throw new Error('Preview plan differs from shared engine');
  return pack;
}
