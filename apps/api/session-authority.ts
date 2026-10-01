import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashObject, signObject } from '../../packages/content/index.ts';
import { authoritySchema, grantSchema, MAX_UPLOAD_MS } from '../../packages/session-runtime/authorization.ts';
import { practiceWindowPolicy } from '../../packages/session-runtime/practice-window.ts';
import type { SessionAuthority } from '../../packages/session-runtime/authorization.ts';
import type { Plan } from '../../packages/task-engine/index.ts';
import type { Database } from './database.ts';

export async function createSessionAuthority(db: Database, options: { dataDir?: string; readOnly?: boolean } = {}) {
  const path = options.dataDir ? resolve(options.dataDir, 'session-signing.jwk.json') : null;
  let privateKey: CryptoKey, publicJwk: JsonWebKey, saved: JsonWebKey | undefined;
  if (process.env.FOCUS_SESSION_SIGNING_JWK) saved = JSON.parse(process.env.FOCUS_SESSION_SIGNING_JWK);
  if (!saved && path) { try { saved = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  if (saved) {
    privateKey = await crypto.subtle.importKey('jwk', saved, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const { d, key_ops, ...rest } = saved; publicJwk = { ...rest, key_ops: ['verify'] };
  } else {
    if (options.readOnly) throw new Error('DATABASE_SESSION_KEY_PREPARATION_REQUIRED');
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    privateKey = pair.privateKey; publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    if (path) { await mkdir(options.dataDir!, { recursive: true, mode: 0o700 }); await writeFile(path, JSON.stringify(await crypto.subtle.exportKey('jwk', privateKey)), { flag: 'wx', mode: 0o600 }); }
  }
  const identity = authoritySchema.parse({ id: 'local-session-' + (await hashObject(publicJwk)).slice(0, 16), purpose: 'session-continuation', jwk: publicJwk });
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
