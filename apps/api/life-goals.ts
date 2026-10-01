import { randomUUID, createHash } from 'node:crypto';
import type { Database, Queryable } from './database.ts';
import type { Principal } from './service.ts';
import type { AgeBand } from '../../packages/task-engine/index.ts';
import { canonical } from '../../packages/content/index.ts';
import { createGoalSchema, goalActionSchema, openGoal,REFLECTION_SHARING_POLICY } from '../../packages/family-support/model.ts';
import type { LifeGoal, LifeSpace, GoalReply, GoalAction } from '../../packages/family-support/model.ts';
import type { FamilyContent } from './family-content.ts';
import { familyContentPolicy } from '../../packages/family-support/publication.ts';
import type { FamilyContentInfo } from '../../packages/family-support/publication.ts';
import { LIFE_HISTORY_VERSION, LIFE_HISTORY_PAGE_SIZE, lifeHistoryQuerySchema, lifeHistoryCursorSchema } from '../../packages/family-support/history.ts';
import type { LifeHistorySpace } from '../../packages/family-support/history.ts';

interface Row { content_hash:string|null; id: string; child_id: string; version: number; state: LifeGoal['state']; template: LifeGoal['template']; support: LifeGoal['support']; created_by: LifeGoal['createdBy']; reflection: LifeGoal['reflection']; reflection_sharing:LifeGoal['reflectionSharing']; created_at: string; updated_at: string; closed_reason: LifeGoal['closedReason']; request_key: string; request_hash: string }
const publicGoal = (r: Row): LifeGoal => ({ contentHash:r.content_hash??null,id: r.id, childId: r.child_id, version: r.version, state: r.state, template: r.template, support: r.support, createdBy: r.created_by, reflection: r.reflection, reflectionSharing:r.reflection_sharing, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(), closedReason: r.closed_reason });
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function lifeGoals(db: Database, dependencies: {
  child(tx: Queryable, p: Principal, id: string, lock?: boolean): Promise<{ age_band: AgeBand; consent_active: boolean; local_confirmation_active: boolean; verified_guardian_consent_active: boolean }>;
  collecting(c: { consent_active: boolean; local_confirmation_active: boolean; verified_guardian_consent_active: boolean }): boolean;
  fail(status: number, code: string, message: string): never;
  now(): number;
  content():Promise<FamilyContent>;
  recentParent(tx:Queryable,p:Principal):Promise<void>;
}) {
  const { child, fail, now } = dependencies;
  const checkKey = (key: string) => { if (!/^[\w-]{16,128}$/.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY', '需要有效的请求标识。'); };
  const requireCollecting = async (tx: Queryable, p: Principal, id: string) => { const c = await child(tx, p, id, true); if (!dependencies.collecting(c)) fail(403, 'CONSENT_REVOKED', '此档案已停止采集。'); return c; };
  async function record(tx: Queryable, row: Row, actor: 'parent' | 'child', action: unknown, key: string | null, hash: string | null) {
    await tx.query('INSERT INTO life_goal_actions(id,goal_id,version,actor_scope,payload,request_key,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), row.id, row.version, actor, action, key, hash, row.updated_at]);
  }
  async function readSpace(p: Principal, childId: string, rawQuery?: unknown): Promise<LifeSpace | LifeHistorySpace> {
      return db.transaction(async tx => {
        const c = await child(tx, p, childId, true);
        let rows: Row[], history: LifeHistorySpace['history'] | undefined;
        if (rawQuery === undefined) {
          // Keep the existing endpoint's bounded shape for installed older apps.
          rows = (await tx.query<Row>("SELECT * FROM life_goals WHERE child_id=$1 ORDER BY (state IN ('proposed','active')) DESC,created_at DESC,id DESC LIMIT 20", [childId])).rows;
        } else {
          const query = lifeHistoryQuerySchema.parse(rawQuery);
          let boundary: { at: string; id: string } | undefined;
          if (query.cursor) {
            try {
              if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
              const value = lifeHistoryCursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
              if (value.childId !== childId) throw new Error();
              boundary = value;
            } catch { fail(400, 'INVALID_LIFE_HISTORY_CURSOR', '历史记录位置无效，请重新读取最新记录。'); }
          }
          const current = await tx.query<Row>("SELECT * FROM life_goals WHERE child_id=$1 AND state IN ('proposed','active')", [childId]);
          const found = await tx.query<Row & { cursor_at: string }>(`SELECT *,
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
            FROM life_goals WHERE child_id=$1 AND state NOT IN ('proposed','active')
            ${boundary ? 'AND (created_at,id)<($2::timestamptz,$3::uuid)' : ''}
            ORDER BY created_at DESC,id DESC LIMIT ${LIFE_HISTORY_PAGE_SIZE + 1}`, boundary ? [childId,boundary.at,boundary.id] : [childId]);
          const page = found.rows.slice(0,LIFE_HISTORY_PAGE_SIZE), last = page.at(-1);
          const nextCursor = found.rows.length > LIFE_HISTORY_PAGE_SIZE && last
            ? Buffer.from(JSON.stringify({v:1,kind:'life-goals',childId,at:last.cursor_at,id:last.id})).toString('base64url') : null;
          rows = [...current.rows,...page];
          history = {version:LIFE_HISTORY_VERSION,pageSize:LIFE_HISTORY_PAGE_SIZE,nextCursor};
        }
        const total = await tx.query<{ n: number }>('SELECT count(*)::int n FROM life_goals WHERE child_id=$1', [childId]);
        const registry=await dependencies.content(),releases:Record<string,FamilyContentInfo>={};
        const unavailable=(hash:string|null):FamilyContentInfo=>({hash,version:null,review:'unreviewed',state:'unavailable'});
        let current;try{current=await registry.current(c.age_band,tx);}catch{/* Keep history and privacy actions readable when a release cannot be verified. */}
        for(const hash of new Set(rows.map(r=>r.content_hash).filter((h):h is string=>!!h))){try{releases[hash]=(await registry.get(hash,tx)).info;}catch{releases[hash]=unavailable(hash);}}
        return { childId, role: p.scope, contentPolicy:familyContentPolicy,content:current?.info??unavailable(null),releases,sharingPolicy:REFLECTION_SHARING_POLICY,collectionActive: dependencies.collecting(c), templates: current?.info.state==='available'?current.pack.templates:[], goals: rows.map(publicGoal), total: total.rows[0].n, ...(history ? {history} : {}) };
      });
  }
  return {
    read(p: Principal, childId: string): Promise<LifeSpace> { return readSpace(p,childId); },
    history(p: Principal, childId: string, query: unknown = {}): Promise<LifeHistorySpace> {
      return readSpace(p,childId,query) as Promise<LifeHistorySpace>;
    },
    async create(p: Principal, childId: string, raw: unknown, key: string): Promise<GoalReply> {
      if(!raw||typeof raw!=='object'||!('contentHash' in raw))fail(428,'FAMILY_CONTENT_UPDATE_REQUIRED','请更新应用并重新读取当前生活内容。');
      const input = createGoalSchema.parse(raw); checkKey(key); const hash = digest({ input, role: p.scope });
      if (input.intent === 'choose' && p.scope !== 'child') fail(403, 'CHILD_REQUIRED', '请在孩子空间里选择。');
      if (input.intent === 'suggest' && p.scope !== 'parent') fail(403, 'PARENT_REQUIRED', '家长建议需要家长身份。');
      return db.transaction(async tx => {
        const c = await requireCollecting(tx, p, childId);
        const prior = (await tx.query<Row>('SELECT * FROM life_goals WHERE child_id=$1 AND request_key=$2', [childId, key])).rows[0];
        if (prior) { if (prior.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '重复请求内容不同。'); return { goal: publicGoal(prior), replayed: true }; }
        if ((await tx.query("SELECT id FROM life_goals WHERE child_id=$1 AND state IN ('proposed','active')", [childId])).rows.length) fail(409, 'GOAL_EXISTS', '请先处理已有生活小目标。');
        const registry=await dependencies.content(),current=await registry.current(c.age_band,tx,true);
        registry.requireAvailable(current.info);
        if(current.info.hash!==input.contentHash)fail(409,'FAMILY_CONTENT_CHANGED','内容已更新，请重新阅读后再选择。');
        const template = current.pack.templates.find(t => t.id === input.templateId)!;
        const timestamp = new Date(now()).toISOString();
        const row = (await tx.query<Row>('INSERT INTO life_goals(id,child_id,version,state,template,support,created_by,created_at,updated_at,request_key,request_hash,content_hash) VALUES($1,$2,1,$3,$4,$5,$6,$7,$7,$8,$9,$10) RETURNING *', [randomUUID(), childId, p.scope === 'parent' ? 'proposed' : 'active', template, input.support, p.scope, timestamp, key, hash,input.contentHash])).rows[0];
        await record(tx, row, p.scope, { action: 'create', ...input }, null, null);
        return { goal: publicGoal(row), replayed: false };
      });
    },
    async act(p: Principal, childId: string, id: string, raw: unknown, match: string | undefined, key: string): Promise<GoalReply> {
      if(raw&&typeof raw==='object'&&'action' in raw&&raw.action==='reflect'&&!('sharing' in raw))fail(428,'SHARING_CHOICE_REQUIRED','请更新应用，并明确选择是否分享本次回顾。');
      const input = goalActionSchema.parse(raw); checkKey(key);
      const header = match ?? fail(428, 'PRECONDITION_REQUIRED', '请读取当前目标版本。');
      if (!/^"[1-9][0-9]{0,8}"$/.test(header)) fail(400, 'INVALID_PRECONDITION', '目标版本无效。');
      const expected = Number(header.slice(1, -1));
      if (!['stop','unshare'].includes(input.action) && p.scope !== 'child') fail(403, 'CHILD_REQUIRED', '请在孩子空间里做这个选择。');
      const hash = digest({ input, expected, role: p.scope });
      return db.transaction(async tx => {
        if(input.action==='unshare'){
          await child(tx,p,childId,true);
          if(p.scope==='parent')await dependencies.recentParent(tx,p);
        }else await requireCollecting(tx, p, childId);
        const row = (await tx.query<Row>('SELECT * FROM life_goals WHERE id=$1 AND child_id=$2 FOR UPDATE', [id, childId])).rows[0];
        if (!row) fail(404, 'NOT_FOUND', '未找到目标。');
        const prior = (await tx.query<{ request_hash: string|null;answers_removed:boolean }>('SELECT request_hash,answers_removed FROM life_goal_actions WHERE goal_id=$1 AND request_key=$2', [id, key])).rows[0];
        if (prior) { if(prior.answers_removed)fail(409,'REFLECTION_WITHDRAWN','这份答案已撤回，旧的分享请求不能再次提交。'); if (prior.request_hash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '重复请求内容不同。'); return { goal: publicGoal(row), replayed: true }; }
        if (row.version !== expected) fail(409, 'GOAL_CONFLICT', '目标已更新，请重新读取。');
        if(input.action==='unshare'){
          if(row.state!=='reflected'||!['family','legacy-family'].includes(row.reflection_sharing))fail(409,'REFLECTION_NOT_SHARED','这份回顾没有可撤回的答案。');
          // Remove both answers and the low-entropy answer-derived retry hash, atomically.
          await tx.query("UPDATE life_goal_actions SET payload=$2,request_hash=NULL,answers_removed=true WHERE goal_id=$1 AND payload ? 'reflection'",[id,{action:'reflect',sharing:'withdrawn',answersRemoved:true}]);
          const updated=(await tx.query<Row>("UPDATE life_goals SET reflection=NULL,reflection_sharing='withdrawn',version=version+1,updated_at=$2 WHERE id=$1 RETURNING *",[id,new Date(now()).toISOString()])).rows[0];
          await record(tx,updated,p.scope,input,key,hash);return {goal:publicGoal(updated),replayed:false};
        }
        if(row.content_hash&&['accept','reflect'].includes(input.action)){const registry=await dependencies.content();registry.requireAvailable((await registry.get(row.content_hash,tx,true)).info);}
        if (!openGoal(publicGoal(row))) fail(409, 'GOAL_CLOSED', '目标已经结束。');
        if ((input.action === 'reflect' && row.state !== 'active') || (['accept', 'decline'].includes(input.action) && row.state !== 'proposed')) fail(409, 'GOAL_CONFLICT', '目标状态已变化，请重新读取。');
        const states: Record<Exclude<GoalAction['action'],'unshare'>, LifeGoal['state']> = { accept: 'active', decline: 'declined', stop: 'stopped', reflect: 'reflected' };
        const sharing=input.action==='reflect'?(input.sharing==='family'?'family':'not-stored'):'not-recorded';
        const updated = (await tx.query<Row>('UPDATE life_goals SET version=version+1,state=$2,support=$3,reflection=$4,updated_at=$5,reflection_sharing=$6 WHERE id=$1 RETURNING *', [id, states[input.action], input.action === 'accept' ? input.support : row.support, input.action === 'reflect'&&input.sharing==='family' ? input.reflection : null, new Date(now()).toISOString(),sharing])).rows[0];
        await record(tx, updated, p.scope, input, key, hash);
        return { goal: publicGoal(updated), replayed: false };
      });
    },
    async withdraw(tx: Queryable, childId: string) {
      const rows = await tx.query<Row>("UPDATE life_goals SET state='stopped',closed_reason='withdrawn',version=version+1,updated_at=$2 WHERE child_id=$1 AND state IN ('proposed','active') RETURNING *", [childId, new Date(now()).toISOString()]);
      for (const row of rows.rows) await record(tx, row, 'parent', { action: 'withdraw' }, null, null);
    },
    async export(tx: Queryable, childId: string) {
      const rows = await tx.query<Row>('SELECT * FROM life_goals WHERE child_id=$1 ORDER BY created_at,id', [childId]);
      const actions = await tx.query('SELECT a.id,a.goal_id,a.version,a.actor_scope,a.payload,a.answers_removed,a.created_at FROM life_goal_actions a JOIN life_goals g ON g.id=a.goal_id WHERE g.child_id=$1 ORDER BY g.created_at,g.id,a.version', [childId]);
      return { goals: rows.rows.map(publicGoal), actions: actions.rows };
    },
  };
}
