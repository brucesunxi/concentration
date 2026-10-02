import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { measureNarrationQuality } from '../scripts/voice-engineering-quality.mjs';

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
