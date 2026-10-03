import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const secretEnvironmentNames = [
  'DATABASE_URL', 'DATABASE_MIGRATION_URL', 'FOCUS_STUDIO_DATABASE_URL',
  'FOCUS_SESSION_SIGNING_JWK', 'AZURE_SPEECH_KEY', 'OPENAI_API_KEY',
  'VERCEL_TOKEN',
];
const patterns = [
  ['NEON_PASSWORD', /\bnpg_[A-Za-z0-9]{16,}\b/],
  ['NEON_CONNECTION', /\bpostgres(?:ql)?:\/\/[^\s:'"/@]{1,128}:[^\s'"/@]{12,}@[a-z0-9.-]+\.neon\.tech\b/i],
  ['AZURE_SPEECH_KEY', /\bAZURE_SPEECH_KEY\s*[:=]\s*['"]?[A-Za-z0-9]{64,}\b/],
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['PRIVATE_JWK', /"kty"\s*:\s*"(?:EC|OKP|RSA)"[^}]{0,2048}"d"\s*:\s*"[A-Za-z0-9_-]{32,}"/],
  ['OPENAI_KEY', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/],
];
const privateNames = /(?:^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:p8|p12|jks|keystore|pem))(?:$)/i;
const maxFileBytes = 64 * 1024 * 1024;

/** Returns only a category. Never include a matching value or excerpt in diagnostics. */
export function sensitiveMaterial(name, bytes, environment = process.env) {
  if (privateNames.test(name) && !name.endsWith('/.env.example') && name !== '.env.example') return 'PRIVATE_FILENAME';
  if (bytes.length > maxFileBytes) return 'FILE_TOO_LARGE_TO_AUDIT';
  for (const key of secretEnvironmentNames) {
    const value = environment[key];
    if (typeof value === 'string' && value.length >= 16 && bytes.includes(Buffer.from(value))) return `ENV_${key}`;
  }
  const content = bytes.toString('latin1');
  for (const [category, pattern] of patterns) if (pattern.test(content)) return category;
  return null;
}

async function auditFile(root, path, environment) {
  const name = relative(root, path).split(sep).join('/');
  const info = await lstat(path);
  if (!info.isFile()) throw new Error(`PUBLIC_SECRET_AUDIT_UNSUPPORTED_FILE ${name}`);
  const category = sensitiveMaterial(name, await readFile(path), environment);
  if (category) throw new Error(`PUBLIC_SECRET_AUDIT_FAILED ${name} ${category}`);
}

export async function auditTrackedFiles(root, environment = process.env) {
  const paths = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
  for (const path of paths) await auditFile(root, join(root, path), environment);
  return paths.length;
}

export async function auditDirectory(directory, environment = process.env) {
  const root = resolve(directory);
  let count = 0;
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else { await auditFile(root, child, environment); count++; }
    }
  }
  await walk(root);
  return count;
}
