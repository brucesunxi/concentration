import {spawn} from 'node:child_process';
import {narrationQualityBounds} from './narration-quality.ts';
import type {NarrationQuality} from './narration-quality.ts';

export {narrationQualityBounds} from './narration-quality.ts';

/** Technical checks only; hearing, wording and age suitability need human review. */
export async function measureNarrationQuality(source:string|Buffer,durationMs:number,ffmpeg=process.env.FOCUS_FFMPEG_PATH||'ffmpeg'):Promise<NarrationQuality>{
  if(!Number.isFinite(durationMs)||durationMs<=0)throw new Error('Invalid audio duration');
  const fromPipe=Buffer.isBuffer(source);
  const args=['-hide_banner','-nostats','-nostdin','-max_alloc','16777216','-threads','1',
    ...(fromPipe?['-protocol_whitelist','pipe','-f','mp3','-i','pipe:0']:['-i',source as string]),
    '-map','0:a:0','-vn','-sn','-dn','-af','silencedetect=noise=-45dB:d=0.05,loudnorm=I=-18:TP=-1:LRA=11:print_format=json','-f','null','-'];
  const log=await new Promise<string>((resolve,reject)=>{
    const child=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe']});
    let stderr='',done=false;
    const fail=(error:Error)=>{if(done)return;done=true;clearTimeout(timer);child.kill('SIGKILL');reject(error);};
    const timer=setTimeout(()=>fail(new Error('Audio quality measurement timed out')),20000);
    child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString('utf8');if(stderr.length>1024*1024)fail(new Error('Audio quality measurement output too large'));});
    child.stdin.on('error',()=>{});
    child.once('error',()=>fail(new Error('Audio quality measurement unavailable')));
    child.once('close',code=>{if(done)return;done=true;clearTimeout(timer);if(code!==0)reject(new Error('Audio quality measurement failed'));else resolve(stderr);});
    child.stdin.end(fromPipe?source:undefined);
  });
  const block=log.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if(!block)throw new Error('Audio loudness measurement unavailable');
  const measured=JSON.parse(block) as {input_i:string;input_tp:string};
  const integratedLufs=Number(measured.input_i),truePeakDbtp=Number(measured.input_tp);
  if(!Number.isFinite(integratedLufs)||!Number.isFinite(truePeakDbtp))throw new Error('Invalid audio loudness');
  const starts=[...log.matchAll(/silence_start: ([0-9.]+)/g)].map(match=>Number(match[1]));
  const ends=[...log.matchAll(/silence_end: ([0-9.]+)/g)].map(match=>Number(match[1]));
  if(starts.length!==ends.length)throw new Error('Incomplete audio silence measurement');
  const leadingSilenceMs=starts[0]<=0.02?Math.round(ends[0]*1000):0;
  const trailingSilenceMs=starts.length&&Math.abs(ends.at(-1)!*1000-durationMs)<100?Math.max(0,durationMs-Math.round(starts.at(-1)!*1000)):0;
  const metrics={integratedLufs,truePeakDbtp,leadingSilenceMs,trailingSilenceMs};
  if(integratedLufs<narrationQualityBounds.minLufs||integratedLufs>narrationQualityBounds.maxLufs||truePeakDbtp>narrationQualityBounds.maxTruePeakDbtp||leadingSilenceMs>narrationQualityBounds.maxLeadMs||trailingSilenceMs>narrationQualityBounds.maxTailMs)
    throw new Error(`Audio engineering quality check failed: ${JSON.stringify(metrics)}`);
  return metrics;
}
