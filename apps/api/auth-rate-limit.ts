import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { Database, Queryable } from './database.ts';

const authPaths = new Map<string, 'setup' | 'login' | 'join'>([
  ['/api/auth/setup', 'setup'],
  ['/api/auth/login', 'login'],
  ['/api/auth/join', 'join'],
]);

export function authRateKind(path: string) { return authPaths.get(path); }

export function authClientIp(request: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }, serverless: boolean) {
  // Vercel overwrites X-Forwarded-For with the public client IP. Local clients
  // cannot choose a different bucket by sending their own forwarding header.
  const source = serverless ? request.headers['x-forwarded-for'] : request.socket.remoteAddress;
  const ip = typeof source === 'string' ? source.trim() : '';
  return isIP(ip) ? ip : 'unknown';
}

export function authClientFingerprint(secret: string, ip: string) {
  return createHmac('sha256', secret).update('focus-auth-rate-v1\0').update(ip).digest('hex');
}

export async function takeAuthSlot(db: Database, kind: 'setup' | 'login' | 'join', fingerprint: string, at = new Date()) {
  const result = await db.query<{ allowed: boolean }>('SELECT public.focus_auth_take_slot($1,$2,$3) AS allowed', [kind, fingerprint, at.toISOString()]);
  return result.rows[0]?.allowed === true;
}

export async function migrateAuthRateLimit(tx: Queryable) {
  if ((await tx.query('SELECT version FROM schema_migrations WHERE version=31')).rows.length) return;
  await tx.query(`CREATE TABLE public.auth_rate_limits (
    kind text NOT NULL CHECK(kind IN ('setup','login','join')),
    client_hash text NOT NULL CHECK(client_hash ~ '^[a-f0-9]{64}$'),
    attempts int NOT NULL CHECK(attempts BETWEEN 1 AND 13),
    window_end timestamptz NOT NULL,
    PRIMARY KEY(kind,client_hash)
  )`);
  await tx.query('CREATE INDEX auth_rate_limits_expiry ON public.auth_rate_limits(window_end)');
  await tx.query('ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY');
  await tx.query(`CREATE FUNCTION public.focus_auth_take_slot(request_kind text, fingerprint text, request_at timestamptz)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE current_attempts int;
    BEGIN
      IF request_kind NOT IN ('setup','login','join') OR fingerprint !~ '^[a-f0-9]{64}$' OR request_at IS NULL THEN
        RAISE EXCEPTION 'AUTH_RATE_INPUT_INVALID' USING ERRCODE='22023';
      END IF;
      DELETE FROM public.auth_rate_limits WHERE window_end < request_at - interval '1 day';
      INSERT INTO public.auth_rate_limits(kind,client_hash,attempts,window_end)
        VALUES(request_kind,fingerprint,1,request_at + interval '10 minutes')
        ON CONFLICT (kind,client_hash) DO UPDATE SET
          attempts=CASE WHEN auth_rate_limits.window_end <= request_at THEN 1 ELSE least(auth_rate_limits.attempts + 1,13) END,
          window_end=CASE WHEN auth_rate_limits.window_end <= request_at THEN request_at + interval '10 minutes' ELSE auth_rate_limits.window_end END
        RETURNING attempts INTO current_attempts;
      RETURN current_attempts <= 12;
    END $$`);
  await tx.query('REVOKE ALL ON FUNCTION public.focus_auth_take_slot(text,text,timestamptz) FROM PUBLIC');
  await tx.query('INSERT INTO schema_migrations(version) VALUES(31)');
}
