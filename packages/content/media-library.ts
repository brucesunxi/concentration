import {z} from 'zod';
import type {NarrationQuality} from '../audio/engineering-quality.ts';
export const MEDIA_UPLOAD_LIMIT=5*1024*1024;
export const MEDIA_STORAGE_LIMIT=256*1024*1024;
export const MEDIA_IMPORT_TTL_MS=24*60*60*1000;
const age=z.enum(['6-8','9-11','12-14','15-17']);
const common={name:z.string().trim().min(2).max(100),source:z.string().trim().min(10).max(500),rights:z.string().trim().min(10).max(500),ageBands:z.array(age).min(1).max(4).refine(a=>new Set(a).size===a.length),rightsConfirmed:z.literal(true)};
export const mediaMetadataSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('characters'),layoutConfirmed:z.literal(true)}).strict(),
  z.object({...common,kind:z.literal('objects'),layoutConfirmed:z.literal(true)}).strict(),
  z.object({...common,kind:z.literal('guide'),locale:z.enum(['zh-CN','en']),transcript:z.string().trim().min(1).max(1000),voice:z.string().trim().min(2).max(120)}).strict(),
]);
export const mediaImportSchema=z.object({metadata:mediaMetadataSchema,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),sourceBytes:z.number().int().min(20).max(MEDIA_UPLOAD_LIMIT)}).strict();
export type MediaMetadata=z.infer<typeof mediaMetadataSchema>;
export interface MediaInspection {version:'media-check-1';processor:string;mime:'image/png'|'audio/mpeg';width?:number;height?:number;durationMs?:number;analysisSampleRate?:number;analysisChannels?:number;peakDbfs?:number;rmsDbfs?:number;clippedFraction?:number;narrationQuality?:NarrationQuality;metadataRemoved:boolean}
export interface LibraryMedia {id:string;actor:string;metadata:MediaMetadata;source_hash:string;source_bytes:number;state:'awaiting'|'ready'|'rejected';asset_hash:string|null;asset_bytes:number|null;inspection:MediaInspection|null;rejection:string|null;created_at:string;expires_at:string}
export const mediaMime=(kind:MediaMetadata['kind'])=>kind==='guide'?'audio/mpeg':'image/png';
export const mediaPath=(hash:string,mime:string)=>`/content-assets/${hash}.${mime==='image/png'?'png':'mp3'}`;
