import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAsset, verifyRelease } from '../packages/content/index.ts';
import { completeEvents } from '../tests/platform/fixtures.ts';
import { verifyAliasUnchanged, verifyDeploymentIdentity } from './deployment-identity.mjs';

// Synthetic data only. This fixed target remains behind Vercel Authentication.
const origin = 'https://concentration-two.vercel.app';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pending = join(root, '.focus-data', 'neon', 'protected-preview-audit-pending.json');
const cleanupOnly = process.argv.slice(2).join(' ') === '--cleanup';
if (process.argv.length > (cleanupOnly ? 3 : 2)) throw new Error('UNEXPECTED_ARGUMENT');
const temporary = await mkdtemp(join(tmpdir(), 'focus-preview-audit-'));
let credentials;

async function runVercel(args) {
  return new Promise((done, reject) => {
    const child = spawn('vercel', args, { cwd: root, signal: AbortSignal.timeout(45000), stdio: ['ignore', 'pipe', 'pipe'] });
    const parts = [];
    child.stdout.on('data', chunk => parts.push(chunk));
    child.stderr.on('data', () => {}); // Never echo auth headers or response details.
    child.once('error', reject);
    child.once('close', code => code === 0 ? done(Buffer.concat(parts).toString('utf8')) : reject(new Error('PROTECTED_PREVIEW_REQUEST_FAILED')));
  });
}

async function call(path, method = 'GET', body, auth, options = {}) {
  const requestId = randomUUID(), headerFile = join(temporary, requestId + '.headers');
  const args = ['curl', '/api' + path, '--deployment', origin, '--', '--silent', '--show-error', '--dump-header', headerFile,
    '--write-out', '\n__FOCUS_HTTP_STATUS__%{http_code}', '--request', method];
  if (method !== 'GET') args.push('--header', `Origin: ${origin}`, '--header', 'Content-Type: application/json');
  if (options.idempotencyKey) args.push('--header', `Idempotency-Key: ${options.idempotencyKey}`);
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
  const output = await runVercel(args);
  const marker = '\n__FOCUS_HTTP_STATUS__', position = output.lastIndexOf(marker);
  if (position < 0) throw new Error('PROTECTED_PREVIEW_STATUS_MISSING');
  const status = Number(output.slice(position + marker.length).trim());
  let value;
  try { value = JSON.parse(output.slice(0, position)); } catch { throw new Error(`PROTECTED_PREVIEW_NON_JSON_${status}`); }
  const headers = await readFile(headerFile, 'utf8');
  await unlink(headerFile);
  return { status, value, headers };
}

async function publicBytes(path) {
  if (!/^\/content-assets\/[a-f0-9]{64}\.(png|mp3)$/.test(path) &&
      !/^\/assets\/[A-Za-z0-9_.-]+\.(js|css|webp)$/.test(path) &&
      !['/', '/index.html', '/offline-shell.json', '/budget.json'].includes(path)) throw new Error('SYNTHETIC_ASSET_PATH_INVALID');
  const requestId = randomUUID(), headerFile = join(temporary, requestId + '.headers'), bodyFile = join(temporary, requestId + '.body');
  const output = await runVercel(['curl', path, '--deployment', origin, '--', '--silent', '--show-error', '--dump-header', headerFile,
    '--output', bodyFile, '--write-out', '__FOCUS_HTTP_STATUS__%{http_code}']);
  const status = Number(output.match(/__FOCUS_HTTP_STATUS__(\d{3})\s*$/)?.[1]);
  const headers = await readFile(headerFile, 'utf8'), bytes = await readFile(bodyFile);
  await Promise.all([unlink(headerFile), unlink(bodyFile)]);
  return { status, headers, bytes };
}

async function deploymentInfo() {
  try { return JSON.parse(await runVercel(['inspect', origin, '--format=json'])); }
  catch { throw new Error('PROTECTED_PREVIEW_INSPECTION_FAILED'); }
}

async function checkDeploymentIdentity() {
  const inspection = await deploymentInfo();
  if (!/^dpl_[A-Za-z0-9]+$/.test(inspection?.id ?? '')) throw new Error('PROTECTED_PREVIEW_INSPECTION_FAILED');
  let deployment;
  try { deployment = JSON.parse(await runVercel(['api', `/v13/deployments/${inspection.id}`, '--raw'])); }
  catch { throw new Error('PROTECTED_PREVIEW_DEPLOYMENT_SOURCE_UNAVAILABLE'); }
  const expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return verifyDeploymentIdentity(inspection, deployment, expectedSha);
}

async function checkWebShell() {
  const shellResponse = await publicBytes('/offline-shell.json');
  const budgetResponse = await publicBytes('/budget.json');
  if (shellResponse.status !== 200 || budgetResponse.status !== 200) throw new Error('SYNTHETIC_WEB_SHELL_MANIFEST_MISSING');
  let shell, budget;
  try {
    shell = JSON.parse(shellResponse.bytes.toString('utf8'));
    budget = JSON.parse(budgetResponse.bytes.toString('utf8'));
  } catch { throw new Error('SYNTHETIC_WEB_SHELL_MANIFEST_INVALID'); }
  if (shell.schemaVersion !== 1 || !Array.isArray(shell.assets) || !Array.isArray(budget.assets) ||
      budget.passed !== true || !Number.isSafeInteger(budget.limitBytes) || !Number.isSafeInteger(budget.totalBytes) ||
      budget.totalBytes > budget.limitBytes || shell.totalBytes !== budget.totalBytes) throw new Error('SYNTHETIC_WEB_SHELL_BUDGET_INVALID');
  const files = shell.assets.filter(asset => asset.url !== '/');
  const budgetFiles = new Map(budget.assets.map(asset => [asset.path, asset]));
  if (files.length !== budget.assets.length || budgetFiles.size !== files.length ||
      shell.assets.filter(asset => asset.url === '/').length !== 1) throw new Error('SYNTHETIC_WEB_SHELL_FILES_INVALID');
  for (const name of ['characters', 'objects']) {
    if (!files.some(asset => new RegExp(`^/assets/${name}-sheet-[A-Za-z0-9_-]+\\.webp$`).test(asset.url)) ||
        files.some(asset => new RegExp(`^/assets/${name}-sheet-.*\\.png$`).test(asset.url))) throw new Error(`SYNTHETIC_WEB_${name.toUpperCase()}_PREVIEW_INVALID`);
  }
  let totalBytes = 0;
  for (const asset of files) {
    if (!asset || typeof asset.url !== 'string' || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('SYNTHETIC_WEB_SHELL_ENTRY_INVALID');
    const reported = budgetFiles.get(asset.url.slice(1));
    if (!reported || reported.bytes !== asset.bytes || reported.sha256 !== asset.sha256) throw new Error('SYNTHETIC_WEB_SHELL_REPORT_MISMATCH');
    const delivered = await publicBytes(asset.url);
    if (delivered.status !== 200 || delivered.bytes.length !== asset.bytes ||
        createHash('sha256').update(delivered.bytes).digest('hex') !== asset.sha256) throw new Error('SYNTHETIC_WEB_SHELL_DELIVERY_MISMATCH');
    totalBytes += delivered.bytes.length;
  }
  const rootAsset = shell.assets.find(asset => asset.url === '/');
  const htmlAsset = files.find(asset => asset.url === '/index.html');
  if (!rootAsset || !htmlAsset || rootAsset.bytes !== htmlAsset.bytes || rootAsset.sha256 !== htmlAsset.sha256 ||
      totalBytes !== shell.totalBytes) throw new Error('SYNTHETIC_WEB_SHELL_TOTAL_MISMATCH');
  const rootPage = await publicBytes('/');
  if (rootPage.status !== 200 || rootPage.bytes.length !== rootAsset.bytes ||
      createHash('sha256').update(rootPage.bytes).digest('hex') !== rootAsset.sha256) throw new Error('SYNTHETIC_WEB_SHELL_ENTRY_MISMATCH');
  return totalBytes;
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
    const deployed = await checkDeploymentIdentity();
    const ready = await call('/ready');
    if (ready.status !== 200 || ready.value?.status !== 'ok') throw new Error('PROTECTED_PREVIEW_NOT_READY');
    const webShellBytes = await checkWebShell();
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
    const billing = await call('/family/billing', 'GET', undefined, original);
    if (billing.status !== 200 || billing.value?.state !== 'preview' || billing.value?.familyId !== viewed.value.family?.id || 'productId' in billing.value) throw new Error('SYNTHETIC_BILLING_STATUS_FAILED');
    const started = await call(`/children/${child.value.id}/sessions`, 'POST', {
      task: 'memory', deviceId: randomUUID(), environment: { platform: 'web', deviceClass: 'desktop', input: 'pointer', modality: 'visual' },
    }, original, { idempotencyKey: randomUUID() });
    if (started.status !== 201 || started.value?.plan?.version !== '2.0.0') throw new Error(`SYNTHETIC_PRACTICE_START_FAILED_${started.status}`);
    const childAuth = webAuth(started), plan = started.value.plan;
    const trust = await call('/content/trust', 'GET', undefined, childAuth);
    const release = await call(`/content/releases/${plan.content.sha256}`, 'GET', undefined, childAuth);
    if (trust.status !== 200 || release.status !== 200) throw new Error('SYNTHETIC_CONTENT_FETCH_FAILED');
    const pack = await verifyRelease(release.value, trust.value.keys, { mode: 'local', market: 'LOCAL' });
    if (pack.id !== plan.content.id || pack.version !== plan.content.version) throw new Error('SYNTHETIC_CONTENT_MISMATCH');
    for (const asset of pack.assets) {
      const media = await publicBytes(asset.path);
      if (media.status !== 200 || !/^cache-control:\s*no-store\s*$/im.test(media.headers) || !/^x-request-id:\s*[^\r\n]+$/im.test(media.headers)) throw new Error('SYNTHETIC_ASSET_ROUTING_FAILED');
      await verifyAsset(asset, new Uint8Array(media.bytes));
    }
    const recalledBytes = await readFile(join(root, 'packages/visuals/archive/objects-sheet-512-preview.png'));
    const recalledHash = createHash('sha256').update(recalledBytes).digest('hex');
    const recalled = await publicBytes(`/content-assets/${recalledHash}.png`);
    if (recalled.status !== 404 || !/^x-request-id:\s*[^\r\n]+$/im.test(recalled.headers)) throw new Error('SYNTHETIC_RECALLED_ASSET_AVAILABLE');
    const events = completeEvents(plan);
    for (let offset = 0; offset < events.length; offset += 100) {
      const saved = await call(`/sessions/${started.value.id}/events`, 'POST', { events: events.slice(offset, offset + 100) }, childAuth);
      if (saved.status !== 200 || saved.value?.highestContiguousSeq !== Math.min(offset + 100, events.length)) throw new Error(`SYNTHETIC_PRACTICE_UPLOAD_FAILED_${saved.status}`);
    }
    const finalized = await call(`/sessions/${started.value.id}/finalize`, 'POST', { lastSeq: events.length }, childAuth);
    if (finalized.status !== 200 || finalized.value?.completed !== true || finalized.value?.engineVersion !== plan.version) throw new Error(`SYNTHETIC_PRACTICE_FINALIZE_FAILED_${finalized.status}`);
    const parentAgain = await call('/auth/login', 'POST', credentials);
    if (parentAgain.status !== 200) throw new Error('SYNTHETIC_PARENT_RELOGIN_FAILED');
    const report = await call(`/children/${child.value.id}/report`, 'GET', undefined, webAuth(parentAgain));
    if (report.status !== 200 || !report.value?.sessions?.some(item => item.id === started.value.id && item.result?.completed === true)) {
      const rows = Array.isArray(report.value?.sessions) ? report.value.sessions : [];
      throw new Error(`SYNTHETIC_REPORT_MISSING_${report.status}_${report.value?.code ?? 'NO_CODE'}_ROWS_${rows.length}_MATCH_${rows.some(item => item.id === started.value.id)}_COMPLETE_${rows.some(item => item.result?.completed === true)}`);
    }
    if (await removeSyntheticFamily()) await unlink(pending);
    const revoked = await call('/me', 'GET', undefined, original);
    if (revoked.status !== 401 || revoked.value?.code !== 'UNAUTHENTICATED') throw new Error('SYNTHETIC_SESSION_STILL_ACTIVE');
    verifyAliasUnchanged(await deploymentInfo(), deployed.deploymentId);
    process.stdout.write(JSON.stringify({ event: 'PROTECTED_PREVIEW_AUDIT', deploymentId: deployed.deploymentId, commit: deployed.commit, databaseReady: true, webShellVerified: true, webShellBytes, familyCreated: true, childRead: true, billingPreviewRead: true, signedMediaVerified: true, recalledMediaRejected: true, practiceFinalized: true, parentReportRead: true, familyDeleted: true, oldSessionRevoked: true }) + '\n');
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
