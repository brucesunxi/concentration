import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const narrationQualityBounds = Object.freeze({ minLufs:-24, maxLufs:-16, maxTruePeakDbtp:-1, maxLeadMs:500, maxTailMs:1200 });

/** Technical checks only: hearing, wording and age suitability still need human review. */
export async function measureNarrationQuality(path,durationMs,ffmpeg=process.env.FOCUS_FFMPEG_PATH || 'ffmpeg') {
  const { stderr:loudnessLog } = await execute(ffmpeg, ['-hide_banner','-nostats','-nostdin','-i',path,'-af','loudnorm=I=-18:TP=-1:LRA=11:print_format=json','-f','null','-'], { timeout:20000,maxBuffer:1024*1024 });
  const block=loudnessLog.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if(!block)throw new Error(`Audio loudness measurement unavailable: ${path}`);
  const measured=JSON.parse(block);
  const integratedLufs=Number(measured.input_i),truePeakDbtp=Number(measured.input_tp);
  if(!Number.isFinite(integratedLufs)||!Number.isFinite(truePeakDbtp))throw new Error(`Invalid audio loudness: ${path}`);
  const { stderr:silenceLog } = await execute(ffmpeg, ['-hide_banner','-nostats','-nostdin','-i',path,'-af','silencedetect=noise=-45dB:d=0.05','-f','null','-'], { timeout:20000,maxBuffer:1024*1024 });
  const starts=[...silenceLog.matchAll(/silence_start: ([0-9.]+)/g)].map(match=>Number(match[1]));
  const ends=[...silenceLog.matchAll(/silence_end: ([0-9.]+)/g)].map(match=>Number(match[1]));
  if(starts.length!==ends.length)throw new Error(`Incomplete audio silence measurement: ${path}`);
  const leadingSilenceMs=starts[0]<=0.02?Math.round(ends[0]*1000):0;
  const trailingSilenceMs=starts.length&&Math.abs(ends.at(-1)*1000-durationMs)<100?Math.max(0,durationMs-Math.round(starts.at(-1)*1000)):0;
  const metrics={ integratedLufs,truePeakDbtp,leadingSilenceMs,trailingSilenceMs };
  if(integratedLufs<narrationQualityBounds.minLufs||integratedLufs>narrationQualityBounds.maxLufs||truePeakDbtp>narrationQualityBounds.maxTruePeakDbtp||leadingSilenceMs>narrationQualityBounds.maxLeadMs||trailingSilenceMs>narrationQualityBounds.maxTailMs)
    throw new Error(`Audio engineering quality check failed: ${path} ${JSON.stringify(metrics)}`);
  return metrics;
}
