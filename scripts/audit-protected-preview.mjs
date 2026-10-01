import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic data only. This fixed target remains behind Vercel Authentication.
const origin = 'https://concentration-two.vercel.app';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pending = join(root, '.focus-data', 'neon', 'protected-preview-audit-pending.json');
const cleanupOnly = process.argv.slice(2).join(' ') === '--cleanup';
if (process.argv.length > (cleanupOnly ? 3 : 2)) throw new Error('UNEXPECTED_ARGUMENT');
const temporary = await mkdtemp(join(tmpdir(), 'focus-preview-audit-'));
let credentials;

async function call(path, method = 'GET', body, auth) {
  const requestId = randomUUID(), headerFile = join(temporary, requestId + '.headers');
  const args = ['curl', '/api' + path, '--deployment', origin, '--', '--silent', '--show-error', '--dump-header', headerFile,
    '--write-out', '\n__FOCUS_HTTP_STATUS__%{http_code}', '--request', method];
  if (method !== 'GET') args.push('--header', `Origin: ${origin}`, '--header', 'Content-Type: application/json');
  if (auth) {
    if (!/^focus_session=[a-f0-9]{64}$/.test(auth.cookie) || !/^[A-Za-z0-9_-]{20,200}$/.test(auth.csrf)) throw new Error('SYNTHETIC_AUTH_FORMAT_INVALID');
    const configFile = join(temporary, requestId + '.curlrc');
    await writeFile(configFile, `header = "Cookie: ${auth.cookie}"\nheader = "X-CSRF-Token: ${auth.csrf}"\n`, { mode: 0o600 });
    args.push('--config', configFile);
  }
  if (body !== undefined) {
    const dataFile = join(temporary, requestId + '.json');
    await writeFile(dataFile, JSON.stringify(body), { mode: 0o600 });
    args.push('--data-binary', '@' + dataFile);
  }
  const output = await new Promise((done, reject) => {
    const child = spawn('vercel', args, { cwd: root, signal: AbortSignal.timeout(45000), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', () => {}); // Never echo auth headers or response details.
    child.once('error', reject);
    child.once('close', code => code === 0 ? done(stdout) : reject(new Error('PROTECTED_PREVIEW_REQUEST_FAILED')));
  });
  const marker = '\n__FOCUS_HTTP_STATUS__', position = output.lastIndexOf(marker);
  if (position < 0) throw new Error('PROTECTED_PREVIEW_STATUS_MISSING');
  const status = Number(output.slice(position + marker.length).trim());
  let value;
  try { value = JSON.parse(output.slice(0, position)); } catch { throw new Error(`PROTECTED_PREVIEW_NON_JSON_${status}`); }
  const headers = await readFile(headerFile, 'utf8');
  await unlink(headerFile);
  return { status, value, headers };
}

function webAuth(result) {
  const cookie = result.headers.match(/^set-cookie:\s*(focus_session=[^;\r\n]+)/im)?.[1];
  if (!cookie || typeof result.value?.csrf !== 'string') throw new Error('PROTECTED_PREVIEW_AUTH_MISSING');
  return { cookie, csrf: result.value.csrf };
}

async function removeSyntheticFamily() {
  const login = await call('/auth/login', 'POST', credentials);
  if (login.status === 403 && login.value?.code === 'LOGIN_FAILED') return true;
  if (login.status !== 200) throw new Error(`SYNTHETIC_LOGIN_FAILED_${login.status}`);
  const result = await call('/family', 'DELETE', { currentPassword: credentials.password, familyName: credentials.name, acknowledged: true }, webAuth(login));
  if (result.status !== 200 || !result.value?.signInRequired) throw new Error(`SYNTHETIC_DELETE_FAILED_${result.status}`);
  return true;
}

try {
  if (cleanupOnly) {
    credentials = JSON.parse(await readFile(pending, 'utf8'));
    if (await removeSyntheticFamily()) await unlink(pending);
    process.stdout.write('Synthetic preview family cleanup confirmed.\n');
  } else {
    const ready = await call('/ready');
    if (ready.status !== 200 || ready.value?.status !== 'ok') throw new Error('PROTECTED_PREVIEW_NOT_READY');
    credentials = { name: 'Synthetic preview audit ' + randomUUID().slice(0, 8), password: 'Synthetic audit passphrase ' + randomUUID() };
    await mkdir(dirname(pending), { recursive: true, mode: 0o700 });
    await writeFile(pending, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
    const setup = await call('/auth/setup', 'POST', { ...credentials, timezone: 'UTC', locale: 'en', residenceCountry: 'ZZ', registrationPlatform: 'web', acknowledgedLocalUse: true });
    if (setup.status !== 200) throw new Error(`SYNTHETIC_SETUP_FAILED_${setup.status}`);
    const original = webAuth(setup);
    const child = await call('/children', 'POST', { alias: 'Synthetic child', ageBand: '9-11', locale: 'en', localConfirmation: true }, original);
    if (child.status !== 201 || typeof child.value?.id !== 'string') throw new Error(`SYNTHETIC_CHILD_FAILED_${child.status}`);
    const viewed = await call('/me', 'GET', undefined, original);
    if (viewed.status !== 200 || viewed.value?.children?.[0]?.id !== child.value.id) throw new Error('SYNTHETIC_READ_FAILED');
    if (await removeSyntheticFamily()) await unlink(pending);
    const revoked = await call('/me', 'GET', undefined, original);
    if (revoked.status !== 401 || revoked.value?.code !== 'UNAUTHENTICATED') throw new Error('SYNTHETIC_SESSION_STILL_ACTIVE');
    process.stdout.write(JSON.stringify({ event: 'PROTECTED_PREVIEW_AUDIT', databaseReady: true, familyCreated: true, childRead: true, familyDeleted: true, oldSessionRevoked: true }) + '\n');
  }
} catch (error) {
  if (credentials && !cleanupOnly) {
    try { if (await removeSyntheticFamily()) await unlink(pending); } catch {}
  }
  process.stderr.write((error instanceof Error ? error.message : 'PROTECTED_PREVIEW_AUDIT_FAILED') + '\n');
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
