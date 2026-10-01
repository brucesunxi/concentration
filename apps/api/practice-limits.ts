import { DAILY_LIMIT } from '../../packages/task-engine/index.ts';
import type { AgeBand } from '../../packages/task-engine/index.ts';
import type { Queryable } from './database.ts';

export interface LimitSettings {
  age_band: AgeBand; daily_limit_minutes: number | null; next_daily_limit_minutes: number | null;
  daily_limit_effective_day: string | null; daily_limit_version: number;
}
export function effectiveMinutes(c: LimitSettings, day: string) {
  const configured = c.daily_limit_effective_day && c.daily_limit_effective_day <= day ? c.next_daily_limit_minutes : c.daily_limit_minutes;
  return Math.min(DAILY_LIMIT[c.age_band] / 60000, configured ?? DAILY_LIMIT[c.age_band] / 60000);
}
export async function usageTotals(tx: Queryable, childId: string, day: string) {
  const result = await tx.query<{ confirmed: number; reserved: number }>(`SELECT
    coalesce(sum(CASE WHEN result IS NOT NULL THEN used_ms ELSE 0 END),0)::int AS confirmed,
    coalesce(sum(CASE WHEN result IS NULL THEN CASE WHEN state='active' THEN budget_ms ELSE used_ms END ELSE 0 END),0)::int AS reserved
    FROM sessions WHERE child_id=$1 AND budget_day=$2`, [childId, day]);
  return result.rows[0];
}
export async function migratePracticeLimits(tx: Queryable) {
  if ((await tx.query('SELECT version FROM schema_migrations WHERE version=19')).rows.length) return;
  await tx.query(`ALTER TABLE children ADD COLUMN daily_limit_minutes int,
    ADD COLUMN next_daily_limit_minutes int, ADD COLUMN daily_limit_effective_day text,
    ADD COLUMN daily_limit_version int NOT NULL DEFAULT 1 CHECK(daily_limit_version>0),
    ADD COLUMN daily_limit_updated_at timestamptz,
    ADD CONSTRAINT daily_limit_range CHECK(daily_limit_minutes IS NULL OR daily_limit_minutes BETWEEN 0 AND CASE age_band WHEN '6-8' THEN 8 WHEN '9-11' THEN 10 ELSE 12 END),
    ADD CONSTRAINT next_daily_limit_range CHECK(next_daily_limit_minutes IS NULL OR next_daily_limit_minutes BETWEEN 0 AND CASE age_band WHEN '6-8' THEN 8 WHEN '9-11' THEN 10 ELSE 12 END),
    ADD CONSTRAINT daily_limit_pending CHECK((next_daily_limit_minutes IS NULL)=(daily_limit_effective_day IS NULL)),
    ADD CONSTRAINT daily_limit_date CHECK(daily_limit_effective_day IS NULL OR daily_limit_effective_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`);
  await tx.query('ALTER TABLE sessions ADD COLUMN daily_limit_snapshot jsonb');
  await tx.query('INSERT INTO schema_migrations(version) VALUES(19)');
}
