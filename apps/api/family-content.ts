import type { Database, Queryable } from './database.ts';
import { ContentError, hashObject, signObject } from '../../packages/content/index.ts';
import type { TrustedKey } from '../../packages/content/index.ts';
import { familyAges, familyPackSchema, verifyFamilyRelease } from '../../packages/family-support/publication.ts';
import type { FamilyPack, FamilyRelease, FamilyContentInfo } from '../../packages/family-support/publication.ts';
import { makeParentGuide } from '../../packages/family-support/parent-guide.ts';
import { lifeTemplates } from '../../packages/family-support/catalogue.ts';
import type { AgeBand } from '../../packages/task-engine/index.ts';

export function initialFamilyPack(ageBand:AgeBand):FamilyPack {
  const version='1.0.0-preview';
  return familyPackSchema.parse({kind:'family-support',schemaVersion:1,id:`family.support.${ageBand}`,version,ageBand,review:'unreviewed',lessons:makeParentGuide('',ageBand,0,true).lessons,templates:lifeTemplates(ageBand).map(t=>({...t,version}))});
}
export async function registerFamilyRelease(tx:Queryable,release:FamilyRelease,trust:TrustedKey[],now:number){
  const pack=await verifyFamilyRelease(release,trust,{mode:'local',now}),hash=release.body.packHash;
  const old=(await tx.query<{hash:string}>('SELECT hash FROM family_content_releases WHERE pack_id=$1 AND version=$2',[pack.id,pack.version])).rows[0];
  if(old){if(old.hash!==hash)throw new ContentError('IMMUTABLE_VERSION_CONFLICT');return hash;}
  await tx.query("INSERT INTO family_content_releases(hash,pack_id,version,envelope,state) VALUES($1,$2,$3,$4,'active')",[hash,pack.id,pack.version,release]);
  return hash;
}
export async function familyContent(db:Database,trust:(tx?:Queryable)=>Promise<TrustedKey[]>,options:{now:()=>number;readOnly?:boolean;identity?:TrustedKey;key?:CryptoKey}){
  const base=new Map<AgeBand,string>();
  const prepared=options.readOnly?new Map((await db.query<{pack_id:string;version:string;hash:string}>('SELECT pack_id,version,hash FROM family_content_releases')).rows.map(row=>[`${row.pack_id}:${row.version}`,row.hash])):undefined;
  for(const age of familyAges){
    const pack=initialFamilyPack(age),hash=await hashObject(pack);
    const old=prepared?(prepared.has(`${pack.id}:${pack.version}`)?{hash:prepared.get(`${pack.id}:${pack.version}`)!}:undefined):(await db.query<{hash:string}>('SELECT hash FROM family_content_releases WHERE pack_id=$1 AND version=$2',[pack.id,pack.version])).rows[0];
    if(old&&old.hash!==hash)throw new ContentError('IMMUTABLE_VERSION_CONFLICT');
    if(!old){
      if(options.readOnly||!options.key||!options.identity)throw new ContentError('DATABASE_CONTENT_PREPARATION_REQUIRED');
      const body:FamilyRelease['body']={domain:'family-support-release-1',pack,packHash:hash,author:'development-catalog',publisher:options.identity.subject,channel:'local-preview',market:'LOCAL',issuedAt:new Date(options.now()).toISOString(),expiresAt:new Date(options.now()+365*86400000).toISOString(),approvals:[]};
      await registerFamilyRelease(db,{body,signature:await signObject(body,options.identity.id,options.key)},await trust(),options.now());
    }
    base.set(age,hash);
  }
  async function get(hash:string,tx:Queryable=db,lock=false){
    const sql=lock&&db.context?'SELECT envelope,state FROM public.focus_locked_family_content($1)':'SELECT envelope,state FROM family_content_releases WHERE hash=$1'+(lock?' FOR SHARE':'');
    const row=(await tx.query<{envelope:FamilyRelease;state:string}>(sql,[hash])).rows[0];
    if(!row)throw new ContentError('FAMILY_CONTENT_UNAVAILABLE');
    const pack=await verifyFamilyRelease(row.envelope,await trust(tx),{mode:'local',now:options.now(),history:true});
    if(row.envelope.body.packHash!==hash)throw new ContentError('PACK_HASH_MISMATCH');
    const state=row.state==='recalled'?'recalled':Date.parse(row.envelope.body.expiresAt)<=options.now()?'expired':'available';
    return {pack,info:{hash,version:pack.version,review:pack.review,state} as FamilyContentInfo};
  }
  function requireAvailable(info:FamilyContentInfo){if(info.state!=='available')throw new ContentError('FAMILY_CONTENT_'+info.state.toUpperCase());}
  return {get,requireAvailable,
    async current(age:AgeBand,tx:Queryable=db,lock=false){
      const row=(await tx.query<{hash:string}>('SELECT hash FROM family_content_channels WHERE age_band=$1',[age])).rows[0];
      const found=await get(row?.hash??base.get(age)!,tx,lock);
      if(found.pack.ageBand!==age)throw new ContentError('FAMILY_CONTENT_AGE_MISMATCH');
      return found;
    },
  };
}
export type FamilyContent=Awaited<ReturnType<typeof familyContent>>;
