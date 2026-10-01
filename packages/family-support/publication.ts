import { z } from 'zod';
import { ContentError, hashObject, verifySigned } from '../content/index.ts';
import type { TrustedKey, ContentVerifier } from '../content/index.ts';

export const familyContentPolicy = 'family-content-1' as const;
export const familyAges = ['6-8', '9-11', '12-14', '15-17'] as const;
export const reviewScopes = ['method', 'language:zh-CN', 'language:en'] as const;
export const sectionIds = [...Array.from({length:9}, (_,i)=>`lesson:${i}`), ...['find','turns','steps','return'].map(id=>`template:${id}`)];
const text = z.string().trim().min(1).max(1000);
export const wordsSchema = z.object({'zh-CN':text,en:text}).strict();
export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/).max(80);
const task = z.enum(['search','stop','memory','sustain']);
const templateId = z.enum(['find','turns','steps','return']);
const lessonSchema = z.object({stage:z.number().int().min(0).max(8),title:wordsSchema,purpose:wordsSchema,invitation:wordsSchema,example:wordsSchema,steps:z.array(wordsSchema).min(1).max(5),fallback:wordsSchema,notice:wordsSchema,templateId:templateId.nullable(),task:task.nullable()}).strict();
const templateSchema = z.object({id:templateId,version:z.string().min(1).max(80),review:z.enum(['unreviewed','approved']),ageBand:z.enum(familyAges),task,title:wordsSchema,steps:z.array(wordsSchema).min(1).max(5),parentTip:wordsSchema}).strict();
const templateTasks = {find:'search',turns:'stop',steps:'memory',return:'sustain'};
const lessonTargets = [null,'find','turns','steps','return','find','turns','steps','return'];
export const familyPackSchema = z.object({kind:z.literal('family-support'),schemaVersion:z.literal(1),id:z.string().regex(/^family\.support\.(6-8|9-11|12-14|15-17)$/),version,ageBand:z.enum(familyAges),review:z.enum(['unreviewed','approved']),lessons:z.array(lessonSchema).length(9),templates:z.array(templateSchema).length(4)}).strict().superRefine((p,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(p.id!==`family.support.${p.ageBand}`)fail('Age and pack identity differ');
  for(const [i,l] of p.lessons.entries()) if(l.stage!==i||l.templateId!==lessonTargets[i]||l.task!==(l.templateId?templateTasks[l.templateId]:null))fail('Lesson mapping cannot change');
  for(const [i,t] of p.templates.entries()) if(t.id!==['find','turns','steps','return'][i]||t.task!==templateTasks[t.id]||t.ageBand!==p.ageBand||t.review!==p.review||t.version!==p.version)fail('Template mapping or version differs');
});
export type FamilyPack = z.infer<typeof familyPackSchema>;
const signature=z.object({keyId:z.string().min(1).max(120),value:z.string().regex(/^[a-f0-9]{128}$/)}).strict();
const approval=z.object({body:z.object({domain:z.literal('family-support-approval-1'),packHash:contentHashSchema,reviewer:z.string().min(1).max(120),scope:z.enum(reviewScopes),approvedAt:z.iso.datetime(),evidence:z.string().trim().min(20).max(700),sections:z.array(z.string()).length(13)}).strict(),signature}).strict();
export const familyReleaseSchema=z.object({body:z.object({domain:z.literal('family-support-release-1'),pack:familyPackSchema,packHash:contentHashSchema,author:z.string().min(1).max(120),publisher:z.string().min(1).max(120),channel:z.enum(['local-preview','reviewed-preview']),market:z.literal('LOCAL'),issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),approvals:z.array(approval).max(3)}).strict(),signature}).strict();
export type FamilyRelease=z.infer<typeof familyReleaseSchema>;
export type FamilyContentState='available'|'recalled'|'expired'|'unavailable'|'legacy';
export interface FamilyContentInfo { hash:string|null;version:string|null;review:'unreviewed'|'approved';state:FamilyContentState }
export const reviewedFamilyPack=(pack:FamilyPack):FamilyPack=>familyPackSchema.parse({...pack,review:'approved',templates:pack.templates.map(t=>({...t,review:'approved'}))});
const check=(condition:unknown,code:string)=>{if(!condition)throw new ContentError(code);};
/** This release type deliberately cannot authorize a production market. */
export async function verifyFamilyRelease(raw:unknown,trust:TrustedKey[],options:{mode:'local'|'production';now?:number;history?:boolean;verifier?:ContentVerifier}){
  const {body,signature}=familyReleaseSchema.parse(raw),now=options.now??Date.now();
  check(options.mode==='local','LOCAL_ONLY_CONTENT');
  const signer=await verifySigned(body,signature,trust,options.verifier);
  check(signer.role==='publisher'&&signer.subject===body.publisher,'PUBLISHER_MISMATCH');
  check(await hashObject(body.pack,options.verifier)===body.packHash,'PACK_HASH_MISMATCH');
  check(Date.parse(body.issuedAt)<=now+60000&&Date.parse(body.expiresAt)>Date.parse(body.issuedAt),'RELEASE_EXPIRED_OR_FUTURE');
  if(!options.history)check(Date.parse(body.expiresAt)>now,'FAMILY_CONTENT_EXPIRED');
  if(body.channel==='local-preview')check(body.approvals.length===0&&body.pack.review==='unreviewed','REVIEW_INCOMPLETE');
  else {
    check(body.pack.review==='approved'&&body.author!==body.publisher,'REVIEW_INCOMPLETE');
    const people=new Set<string>(),scopes=new Set<string>();
    for(const a of body.approvals){
      const r=await verifySigned(a.body,a.signature,trust,options.verifier);
      check(a.body.reviewer===r.subject&&r.role===(a.body.scope==='method'?'method-reviewer':'language-reviewer')&&a.body.packHash===body.packHash,'APPROVAL_MISMATCH');
      check(!people.has(r.subject)&&r.subject!==body.author&&r.subject!==body.publisher,'REVIEWER_CONFLICT');
      check(!scopes.has(a.body.scope)&&sectionIds.every(id=>a.body.sections.includes(id))&&new Set(a.body.sections).size===13,'REVIEW_INCOMPLETE');
      check(Date.parse(a.body.approvedAt)<=Date.parse(body.issuedAt),'APPROVAL_AFTER_RELEASE');
      people.add(r.subject);scopes.add(a.body.scope);
    }
    check(reviewScopes.every(s=>scopes.has(s)),'THREE_REVIEWS_REQUIRED');
    check(Date.parse(body.expiresAt)-Date.parse(body.issuedAt)<=30*86400000,'RELEASE_WINDOW_INVALID');
  }
  return body.pack;
}
