// Synthetic data for local UI acceptance only; never run against a remote host.
const base = 'http://127.0.0.1:4181/api';
const headers = { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4180' };
const name = '验收家庭020', password = 'Local-QA-2026-020!';
const health = await (await fetch(base + '/health')).json();
if (health.mode !== 'local-development') throw new Error('Only local preview seeding is allowed.');
let response = await fetch(base + '/auth/setup', { method: 'POST', headers, body: JSON.stringify({ name, password, timezone: 'Asia/Shanghai', locale: 'zh-CN', acknowledgedLocalUse: true }) });
if (response.status === 409) response = await fetch(base + '/auth/login', { method: 'POST', headers, body: JSON.stringify({ name, password }) });
const auth = await response.json();
if (!response.ok) throw new Error('QA family setup failed: ' + auth.code);
headers.Cookie = response.headers.get('set-cookie').split(';')[0];
headers['X-CSRF-Token'] = auth.csrf;
const me = await (await fetch(base + '/me', { headers })).json();
for (const profile of [{ alias: '体验小树', ageBand: '6-8', locale: 'zh-CN' }, { alias: 'River', ageBand: '15-17', locale: 'en' }]) {
  if (me.children.some(child => child.alias === profile.alias)) continue;
  const added = await fetch(base + '/children', { method: 'POST', headers, body: JSON.stringify({ ...profile, localConfirmation: true }) });
  if (!added.ok) throw new Error('QA profile setup failed');
}
console.log('Synthetic local QA family is ready. No real child data was used.');
