import { AsyncLocalStorage } from 'node:async_hooks';

export type DatabaseContext =
  | { mode: 'family'; familyId: string; childId: string | null; scope: 'parent' | 'child'; memberId?: string; memberRole?: string; memberState?: string; childIds?: string[] }
  | { mode: 'setup'; familyId: string }
  | { mode: 'login'; loginName: string; memberLogin?: string }
  | { mode: 'identity'; familyId: string; memberId: string }
  | { mode: 'join'; inviteHash: string }
  | { mode: 'authenticate'; tokenHash: string };

export function databaseContext() {
  const storage = new AsyncLocalStorage<DatabaseContext>();
  return {
    run<T>(context: DatabaseContext, action: () => Promise<T>) { return storage.run(context, action); },
    values() {
      const context = storage.getStore();
      return [context?.mode ?? '', context && 'familyId' in context ? context.familyId : '',
        context?.mode === 'family' ? context.childId ?? '' : '', context?.mode === 'family' ? context.scope : '',
        context?.mode === 'login' ? context.loginName : '', context?.mode === 'authenticate' ? context.tokenHash : '',
        context && 'memberId' in context ? context.memberId ?? '' : '', context?.mode === 'family' ? context.memberRole ?? '' : '',
        context?.mode === 'family' ? context.memberState ?? '' : '', context?.mode === 'family' ? '{'+(context.childIds ?? []).join(',')+'}' : '{}',
        context?.mode === 'login' ? context.memberLogin ?? 'owner' : '', context?.mode === 'join' ? context.inviteHash : ''];
    },
  };
}

// Every connection checkout sets all values, including empty values. The setting
// is transaction-local: committing/rolling back never carries a family onward.
export const CONTEXT_SQL = `SELECT
  set_config('focus.mode',$1,true), set_config('focus.family_id',$2,true),
  set_config('focus.child_id',$3,true), set_config('focus.scope',$4,true),
  set_config('focus.login_name',$5,true), set_config('focus.token_hash',$6,true),
  set_config('focus.member_id',$7,true), set_config('focus.member_role',$8,true),
  set_config('focus.member_state',$9,true), set_config('focus.child_ids',$10,true),
  set_config('focus.member_login',$11,true), set_config('focus.invite_hash',$12,true)`;
