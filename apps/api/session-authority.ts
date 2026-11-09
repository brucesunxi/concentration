import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashObject, signObject } from '../../packages/content/index.ts';
import { authoritySchema, grantSchema, MAX_UPLOAD_MS } from '../../packages/session-runtime/authorization.ts';
import { REQUIRED_SCHEMA_VERSION } from './family-isolation.ts';
import { practiceWindowPolicy } from '../../packages/session-runtime/practice-window.ts';
import type { SessionAuthority } from '../../packages/session-runtime/authorization.ts';
import type { Plan } from '../../packages/task-engine/index.ts';
import type { Database } from './database.ts';

export async function sessionAuthorityFromPrivateJwk(privateJwk: JsonWebKey): Promise<SessionAuthority> {
  if (!privateJwk || typeof privateJwk !== 'object' || Array.isArray(privateJwk) || typeof privateJwk.d !== 'string' || !privateJwk.d) throw new Error('SESSION_JWK_INVALID');
  await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const { d: _private, key_ops: _ops, ...rest } = privateJwk;
  const jwk = { ...rest, key_ops: ['verify'] as ['verify'] };
  return authoritySchema.parse({ id: 'local-session-' + (await hashObject(jwk)).slice(0, 16), purpose: 'session-continuation', jwk });
}

/** Append one public session authority. Existing rows are compared and left unchanged. */
export async function registerExistingSessionAuthority(db: Database, identity: SessionAuthority): Promise<{ id: string; inserted: boolean; preserved: number }> {
  const parsed = authoritySchema.parse(identity);
  if ('d' in parsed.jwk) throw new Error('SESSION_JWK_INVALID');
  return db.transaction(async tx => {
    const version = (await tx.query<{ version: number | null }>('SELECT max(version) AS version FROM schema_migrations')).rows[0]?.version;
    if (version !== REQUIRED_SCHEMA_VERSION) throw new Error('DATABASE_SCHEMA_UPGRADE_REQUIRED');
    const role = (await tx.query<{ role: string }>('SELECT current_user AS role')).rows[0]?.role;
    if (role === 'focus_family_runtime') throw new Error('SESSION_AUTHORITY_RUNTIME_ROLE_FORBIDDEN');
    const writable = (await tx.query<{ yes: boolean }>("SELECT has_table_privilege(current_user,'public.session_authorities','INSERT') AS yes")).rows[0]?.yes;
    if (!writable) throw new Error('SESSION_AUTHORITY_INSERT_REQUIRED');
    const before = (await tx.query<{ id: string; identity: SessionAuthority }>('SELECT id, identity FROM session_authorities ORDER BY id')).rows;
    const existing = before.find(row => row.id === parsed.id);
    if (existing) {
      if (await hashObject(existing.identity) !== await hashObject(parsed)) throw new Error('SESSION_AUTHORITY_CONFLICT');
      return { id: parsed.id, inserted: false, preserved: before.length };
    }
    await tx.query('INSERT INTO session_authorities(id,identity) VALUES($1,$2)', [parsed.id, parsed]);
    const after = (await tx.query<{ id: string; identity: SessionAuthority }>('SELECT id, identity FROM session_authorities ORDER BY id')).rows;
    for (const row of before) {
      const match = after.find(item => item.id === row.id);
      if (!match || await hashObject(match.identity) !== await hashObject(row.identity)) throw new Error('SESSION_AUTHORITY_PRESERVATION_FAILED');
    }
    if (after.length !== before.length + 1 || !after.some(row => row.id === parsed.id)) throw new Error('SESSION_AUTHORITY_PRESERVATION_FAILED');
    return { id: parsed.id, inserted: true, preserved: before.length };
  });
}

export async function createSessionAuthority(db: Database, options: { dataDir?: string; readOnly?: boolean } = {}) {
  const path = options.dataDir ? resolve(options.dataDir, 'session-signing.jwk.json') : null;
  let privateKey: CryptoKey, saved: JsonWebKey | undefined;
  if (process.env.FOCUS_SESSION_SIGNING_JWK) saved = JSON.parse(process.env.FOCUS_SESSION_SIGNING_JWK);
  if (!saved && path) { try { saved = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  let identity: SessionAuthority;
  if (saved) {
    privateKey = await crypto.subtle.importKey('jwk', saved, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    identity = await sessionAuthorityFromPrivateJwk(saved);
  } else {
    if (options.readOnly) throw new Error('DATABASE_SESSION_KEY_PREPARATION_REQUIRED');
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    privateKey = pair.privateKey;
    const exported = await crypto.subtle.exportKey('jwk', privateKey);
    if (path) { await mkdir(options.dataDir!, { recursive: true, mode: 0o700 }); await writeFile(path, JSON.stringify(exported), { flag: 'wx', mode: 0o600 }); }
    identity = await sessionAuthorityFromPrivateJwk(exported);
  }
  if (options.readOnly) {
    const existing = (await db.query<{ identity: SessionAuthority }>('SELECT identity FROM session_authorities WHERE id=$1', [identity.id])).rows[0];
    if (!existing || await hashObject(existing.identity) !== await hashObject(identity)) throw new Error('DATABASE_SESSION_AUTHORITY_PREPARATION_REQUIRED');
  } else await db.query('INSERT INTO session_authorities(id,identity) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [identity.id, identity]);
  return {
    async trust(): Promise<SessionAuthority[]> { return (await db.query<{ identity: SessionAuthority }>('SELECT identity FROM session_authorities ORDER BY id')).rows.map(row => authoritySchema.parse(row.identity)); },
    async issue(input: { id: string; childId: string; deviceId: string; plan: Plan; budgetMs: number; transport: 'web' | 'native'; now: number; contentExpiry: number; dayEnd: number }) {
      const windowPolicy = practiceWindowPolicy(input.plan.ageBand);
      const body = {
        kind: 'focus-session-continuation' as const, version: 2 as const, mode: 'local-development' as const, windowPolicy,
        sessionId: input.id, childId: input.childId, deviceId: input.deviceId, planHash: await hashObject(input.plan), transport: input.transport,
        maxActiveMs: input.budgetMs, maxEvents: 3000 as const, issuedAt: new Date(input.now).toISOString(),
        recordUntil: new Date(Math.min(input.now + windowPolicy.maxElapsedMs, input.contentExpiry, input.dayEnd)).toISOString(), uploadUntil: new Date(input.now + MAX_UPLOAD_MS).toISOString(),
      };
      return grantSchema.parse({ body, signature: await signObject(body, identity.id, privateKey) });
    },
  };
}
export type LocalSessionAuthority = Awaited<ReturnType<typeof createSessionAuthority>>;
