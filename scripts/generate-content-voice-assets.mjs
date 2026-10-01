import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { CONTENT_NARRATIONS, narrationText } from '../packages/content/voice-catalogue.ts';
import { processMedia } from '../apps/api/media-processor.ts';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyIndex = args.indexOf('--only');
if (onlyIndex >= 0 && (!args[onlyIndex + 1] || onlyIndex !== args.length - 2)) throw new Error('Usage: node scripts/generate-content-voice-assets.mjs [--dry-run] [--only filename-without-mp3]');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
const entries = CONTENT_NARRATIONS.filter(item => !item.existing && (!only || item.relativePath.endsWith(`/${only}.mp3`)));
if (only && entries.length !== 1) throw new Error('Unknown or existing narration ID');
if (dryRun) {
  for (const item of entries) console.log(`${item.relativePath} | ${item.voice} | ${narrationText(item)}`);
  console.log(`${entries.length} recordings planned; no network request made.`);
  process.exit(0);
}

// The key is read once from a non-echoing TTY or environment; it is never written to
// disk, included in logs, or embedded in the application bundle.
let key = process.env.AZURE_SPEECH_KEY;
if (!key) {
  console.log('Waiting for Azure Speech key on stdin.');
  const raw = process.stdin.isTTY && process.stdin.setRawMode;
  if (raw) process.stdin.setRawMode(true);
  try {
    key = await new Promise((resolveKey, reject) => {
      let input = '';
      process.stdin.setEncoding('utf8');
      const receive = chunk => {
        input += chunk;
        const end = input.search(/[\r\n]/);
        if (end < 0) return;
        process.stdin.off('data', receive);
        resolveKey(input.slice(0, end).trim());
      };
      process.stdin.on('data', receive);
      process.stdin.once('end', () => reject(new Error('No Azure Speech key received')));
      process.stdin.resume();
    });
  } finally {
    if (raw) process.stdin.setRawMode(false);
  }
}
if (!key) throw new Error('Azure Speech key is required');
const region = process.env.AZURE_SPEECH_REGION || 'eastus';
if (!/^[a-z0-9-]+$/.test(region)) throw new Error('Invalid Azure Speech region');
const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
const escapeXML = value => String(value).replace(/[<>&"']/g, ch => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[ch]);
for (const item of entries) {
  const path = resolve(root, item.relativePath);
  try {
    const existing = await readFile(path);
    if (existing.length < 1024) throw new Error(`Existing recording is too small: ${item.relativePath}`);
    console.log(`Existing: ${item.relativePath}`);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const text = narrationText(item);
  const ssml = `<speak version="1.0" xml:lang="${item.locale === 'en' ? 'en-US' : 'zh-CN'}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${item.voice}"><prosody rate="${item.rate}" pitch="${item.pitch}">${escapeXML(text)}</prosody></voice></speak>`;
  const response = await fetch(endpoint, {
    method:'POST',
    headers:{ 'Ocp-Apim-Subscription-Key':key, 'Content-Type':'application/ssml+xml', 'X-Microsoft-OutputFormat':'audio-24khz-48kbitrate-mono-mp3', 'User-Agent':'focus-island-content-production' },
    body:ssml, signal:AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Azure Speech failed for ${item.relativePath}: HTTP ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());
  const processed = await processMedia('guide', source);
  await mkdir(dirname(path), { recursive:true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, processed.body, { flag:'wx' });
    await rename(temporary, path);
  } catch (error) {
    await import('node:fs/promises').then(fs => fs.rm(temporary,{force:true}));
    throw error;
  }
  const sha256 = createHash('sha256').update(processed.body).digest('hex');
  console.log(`Generated ${item.relativePath} | ${processed.body.length} bytes | ${processed.inspection.durationMs} ms | sha256 ${sha256}`);
}
console.log(`Complete: ${entries.length} requested candidate recordings. Human listening and content review are still required.`);
