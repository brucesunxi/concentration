import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { measureNarrationQuality } from '../scripts/voice-engineering-quality.mjs';
import { taskContent } from '../packages/content/copy.ts';

function durationMs(path) {
  const result=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',path],{encoding:'utf8'}));
  return Math.round(Number(result.format.duration)*1000);
}

test('narration engineering check measures a current recording and rejects quiet or padded substitutes',async()=>{
  const current=resolve(import.meta.dirname,'../src/audio/search-rule.mp3');
  const measured=await measureNarrationQuality(current,durationMs(current));
  assert.ok(measured.integratedLufs<-16&&measured.integratedLufs>-24);
  const folder=mkdtempSync(join(tmpdir(),'focus-voice-quality-'));
  try{
    const quiet=join(folder,'quiet.mp3'),padded=join(folder,'padded.mp3');
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=700:duration=1','-af','volume=-30dB','-ac','1','-ar','24000','-codec:a','libmp3lame','-y',quiet]);
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=700:duration=1','-af','apad=pad_dur=2','-ac','1','-ar','24000','-codec:a','libmp3lame','-y',padded]);
    await assert.rejects(measureNarrationQuality(quiet,durationMs(quiet)),/Audio engineering quality check failed/);
    await assert.rejects(measureNarrationQuality(padded,durationMs(padded)),/trailingSilenceMs/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('rule candidate plan uses all four complete stop instructions without touching signed assets',()=>{
  const output=execFileSync(process.execPath,['scripts/generate-content-voice-assets.mjs','--missing-rules','--dry-run'],{encoding:'utf8'});
  const lines=output.trim().split('\n');
  assert.equal(lines.length,5);
  for(const [cohort,age] of [['child','6-8'],['teen','12-14']])
    for(const [suffix,locale] of [['zh','zh-CN'],['en','en']]){
      const line=lines.find(value=>value.startsWith(`dist/content-rule-candidates/stop-rule-${cohort}-${suffix}.mp3 | `));
      assert.ok(line);
      assert.ok(line.endsWith(` | ${taskContent('stop',locale,age).rule}`));
    }
  assert.equal(lines[4],'4 recordings planned; no network request made.');
});
