import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { CONTENT_NARRATIONS, contentNarration, narrationText } from '../packages/content/voice-catalogue.ts';
import { TASKS } from '../packages/task-engine/index.ts';
import { measureNarrationQuality, narrationQualityBounds } from './voice-engineering-quality.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node scripts/audit-content-voice-assets.mjs [--out report.json]');
const ffprobe = process.env.FOCUS_FFPROBE_PATH || 'ffprobe';
const execute = promisify(execFile);
const rows = [];
for (const item of CONTENT_NARRATIONS) {
  const body = await readFile(resolve(root, item.relativePath));
  if (body.length < 1024 || body.length > 5 * 1024 * 1024) throw new Error(`Invalid audio size: ${item.relativePath}`);
  const { stdout } = await execute(ffprobe, ['-v','error','-select_streams','a:0','-show_entries','stream=codec_name,sample_rate,channels:format=duration','-of','json',resolve(root,item.relativePath)], { timeout:10000 });
  const probe = JSON.parse(stdout), stream = probe.streams?.[0];
  const durationMs = Math.round(Number(probe.format?.duration) * 1000);
  if (stream?.codec_name !== 'mp3' || stream.channels !== 1 || Number(stream.sample_rate) < 16000 || !Number.isFinite(durationMs) || durationMs < 200 || durationMs > 120000)
    throw new Error(`Invalid audio format: ${item.relativePath}`);
  const quality=await measureNarrationQuality(resolve(root,item.relativePath),durationMs);
  rows.push({
    task:item.task, locale:item.locale, cohort:item.cohort, copyKey:item.copyKey,
    transcript:narrationText(item), voice:item.voice, rate:item.rate, pitch:item.pitch,
    file:item.relativePath, source:item.existing ? 'prior-candidate' : 'azure-speech-candidate',
    sha256:createHash('sha256').update(body).digest('hex'), bytes:body.length,
    durationMs, sampleRate:Number(stream.sample_rate), channels:stream.channels,
    ...quality,
    review:'pending-human-listening',
  });
}
const slots = [];
for (const ageBand of ['6-8','9-11','12-14','15-17'])
  for (const locale of ['zh-CN','en'])
    for (const task of TASKS) {
      const item = contentNarration(task,ageBand,locale);
      slots.push({ ageBand, locale, task, copyKey:item.copyKey, file:item.relativePath });
    }
if (rows.length !== 16 || slots.length !== 32 || new Set(rows.map(row => row.file)).size !== 16) throw new Error('Narration catalogue coverage is incomplete');
const report = {
  schemaVersion:1, generatedAt:new Date().toISOString(),
  scope:'Local source audio inspection only. Does not certify speech quality, native-language review, child understanding or market publication.',
  qualityBounds:narrationQualityBounds,
  summary:{
    sourceFiles:rows.length,
    generatedCandidates:rows.filter(row => row.source === 'azure-speech-candidate').length,
    coveredContentSlots:slots.length,
    narratedRuleSlots:slots.filter(slot => slot.copyKey === 'rule').length,
    narratedStrategySlots:slots.filter(slot => slot.copyKey === 'strategy').length,
    ruleNarrationGaps:slots.filter(slot => slot.copyKey !== 'rule').length,
    engineeringQualityChecked:rows.length,
    humanApproved:0,
  },
  rows, slots,
};
if (args.length) await writeFile(resolve(root,args[1]), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
