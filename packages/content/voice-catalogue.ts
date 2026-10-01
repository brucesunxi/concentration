import type { AgeBand, Locale, TaskId } from '../task-engine/index.ts';
import { isTeen, taskContent } from './copy.ts';

export interface ContentNarration {
  task: TaskId;
  locale: Locale;
  cohort: 'child' | 'teen';
  copyKey: 'rule' | 'strategy';
  relativePath: string;
  voice: string;
  rate: string;
  pitch: string;
  existing?: boolean;
}

// One immutable recording per exact instruction, language and age cohort.
// Reused by both age bands within a cohort; all releases remain unreviewed until
// the content and native-language reviewers approve the actual audio bytes.
export const CONTENT_NARRATIONS: readonly ContentNarration[] = [
  { task:'search', locale:'zh-CN', cohort:'child', copyKey:'rule', relativePath:'src/audio/search-rule.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-8%', pitch:'+1st', existing:true },
  { task:'stop', locale:'zh-CN', cohort:'child', copyKey:'strategy', relativePath:'src/audio/stop-strategy.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-8%', pitch:'+1st', existing:true },
  { task:'memory', locale:'zh-CN', cohort:'child', copyKey:'rule', relativePath:'src/audio/memory-rule.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-8%', pitch:'+1st', existing:true },
  { task:'sustain', locale:'zh-CN', cohort:'child', copyKey:'rule', relativePath:'src/audio/content/sustain-child-zh.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-8%', pitch:'+1st' },
  { task:'search', locale:'en', cohort:'child', copyKey:'rule', relativePath:'src/audio/content/search-child-en.mp3', voice:'en-US-JennyNeural', rate:'-7%', pitch:'+1st' },
  { task:'stop', locale:'en', cohort:'child', copyKey:'strategy', relativePath:'src/audio/content/stop-child-en.mp3', voice:'en-US-JennyNeural', rate:'-7%', pitch:'+1st' },
  { task:'memory', locale:'en', cohort:'child', copyKey:'rule', relativePath:'src/audio/content/memory-child-en.mp3', voice:'en-US-JennyNeural', rate:'-7%', pitch:'+1st' },
  { task:'sustain', locale:'en', cohort:'child', copyKey:'rule', relativePath:'src/audio/content/sustain-child-en.mp3', voice:'en-US-JennyNeural', rate:'-7%', pitch:'+1st' },
  { task:'search', locale:'zh-CN', cohort:'teen', copyKey:'rule', relativePath:'src/audio/content/search-teen-zh.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-2%', pitch:'medium' },
  { task:'stop', locale:'zh-CN', cohort:'teen', copyKey:'strategy', relativePath:'src/audio/content/stop-teen-zh.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-2%', pitch:'medium' },
  { task:'memory', locale:'zh-CN', cohort:'teen', copyKey:'rule', relativePath:'src/audio/content/memory-teen-zh.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-2%', pitch:'medium' },
  { task:'sustain', locale:'zh-CN', cohort:'teen', copyKey:'rule', relativePath:'src/audio/content/sustain-teen-zh.mp3', voice:'zh-CN-XiaoxiaoNeural', rate:'-2%', pitch:'medium' },
  { task:'search', locale:'en', cohort:'teen', copyKey:'rule', relativePath:'src/audio/content/search-teen-en.mp3', voice:'en-US-JennyNeural', rate:'-2%', pitch:'medium' },
  { task:'stop', locale:'en', cohort:'teen', copyKey:'strategy', relativePath:'src/audio/content/stop-teen-en.mp3', voice:'en-US-JennyNeural', rate:'-2%', pitch:'medium' },
  { task:'memory', locale:'en', cohort:'teen', copyKey:'rule', relativePath:'src/audio/content/memory-teen-en.mp3', voice:'en-US-JennyNeural', rate:'-2%', pitch:'medium' },
  { task:'sustain', locale:'en', cohort:'teen', copyKey:'rule', relativePath:'src/audio/content/sustain-teen-en.mp3', voice:'en-US-JennyNeural', rate:'-2%', pitch:'medium' },
];

export function contentNarration(task: TaskId, ageBand: AgeBand, locale: Locale): ContentNarration {
  const cohort = isTeen(ageBand) ? 'teen' : 'child';
  const matches = CONTENT_NARRATIONS.filter(item => item.task === task && item.locale === locale && item.cohort === cohort);
  if (matches.length !== 1) throw new Error(`NARRATION_MAPPING_INVALID:${task}:${ageBand}:${locale}`);
  return matches[0];
}

export function narrationText(item: ContentNarration): string {
  return taskContent(item.task, item.locale, item.cohort === 'teen' ? '12-14' : '6-8')[item.copyKey];
}
