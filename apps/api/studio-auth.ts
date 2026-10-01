import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Database, Queryable } from './database.ts';
import { trustedKeySchema, signObject } from '../../packages/content/index.ts';

export const studioRole = z.enum(['editor','method-reviewer','language-reviewer','publisher']);
export type StudioRole = z.infer<typeof studioRole>;
export class StudioError extends Error {
  status:number; code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
export const studioFail=(status:number,code:string,message:string):never=>{throw new StudioError(status,code,message);};
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export const safeEqual=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);};
const derive=promisify(scrypt);
export interface StudioSecret { totp:string; signingKey:JsonWebKey }
export interface StudioVault { read(id:string):Promise<StudioSecret>; write(id:string,value:StudioSecret):Promise<void> }
export function fileStudioVault(dataDir:string):StudioVault {
  const root=resolve(dataDir,'studio-secrets');
  const path=(id:string)=>{z.uuid().parse(id);return resolve(root,id+'.json');};
  return {async read(id){return JSON.parse(await readFile(path(id),'utf8'));},async write(id,value){await mkdir(root,{recursive:true,mode:0o700});await writeFile(path(id),JSON.stringify(value),{mode:0o600,flag:'wx'});}};
}
/** RFC 6238, 30-second step; hex secret is stored outside the database. */
export function totp(secret:string,at:number,digits=6,algorithm='sha1') {
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(at/30000)));
  const mac=createHmac(algorithm,Buffer.from(secret,'hex')).update(counter).digest();const offset=mac.at(-1)!&15;
  return String((mac.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');
}
export function base32Secret(hex:string){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,result='';
  for(const byte of Buffer.from(hex,'hex')){value=(value<<8)|byte;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}
  if(bits)result+=alphabet[(value<<(5-bits))&31];return result;
}
const userSchema=z.object({login:z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),name:z.string().trim().min(2).max(60),role:studioRole,password:z.string().min(12).max(128)}).strict();
/** Provisioning is an operator-only local command, never a family or HTTP route. */
export async function provisionStudioUser(db:Database,vault:StudioVault,raw:unknown,now=Date.now()){
  const input=userSchema.parse(raw),id=randomUUID(),salt=randomBytes(16).toString('hex');
  const hash=(await derive(input.password,salt,64) as Buffer).toString('hex');
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const secret={totp:randomBytes(20).toString('hex'),signingKey:await crypto.subtle.exportKey('jwk',keys.privateKey)};
  const identity=input.role==='editor'?null:trustedKeySchema.parse({id:'studio-'+id,subject:id,role:input.role,jwk:await crypto.subtle.exportKey('jwk',keys.publicKey)});
  await vault.write(id,secret);
  await db.transaction(async tx=>{
    await tx.query('INSERT INTO studio_users(id,login,name,role,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)',[id,input.login,input.name,input.role,salt+':'+hash,new Date(now).toISOString()]);
    if(identity)await tx.query('INSERT INTO content_signers VALUES($1,$2)',[identity.id,identity]);
    await tx.query('INSERT INTO studio_audit(id,draft_id,actor,action,at,detail) VALUES($1,NULL,$2,$3,$4,$5)',[randomUUID(),id,'identity-provisioned',new Date(now).toISOString(),{login:input.login,role:input.role}]);
  });
  return {id,login:input.login,name:input.name,role:input.role,authenticatorSecret:base32Secret(secret.totp)};
}
export interface StudioPrincipal { id:string; name:string; role:StudioRole; csrf:string; token_hash:string; mfa_at:string }
interface User { id:string;login:string;name:string;role:StudioRole;password_hash:string;enabled:boolean;last_totp_step:string|number;failed_count:number;locked_until:string|null }
const loginSchema=z.object({login:z.string().max(64),password:z.string().max(128),code:z.string().regex(/^\d{6}$/)}).strict();
export function studioAuth(db:Database,vault:StudioVault,now:()=>number=Date.now){
  async function validPassword(password:string,stored:string){const [salt,hash]=stored.split(':');return safeEqual((await derive(password,salt,64) as Buffer).toString('hex'),hash);}
  async function verifyCredentials(raw:unknown,requiredId?:string){
    const input=loginSchema.parse(raw);
    // Lockout updates deliberately commit even on a rejected credential.
    const result=await db.transaction(async tx=>{
      const user=(await tx.query<User>('SELECT * FROM studio_users WHERE login=$1 FOR UPDATE',[input.login])).rows[0];
      if(!user){await derive(input.password,'studio-unknown-login-cost',64);return null;}
      if(!user.enabled||(requiredId&&user.id!==requiredId)||(user.locked_until&&Date.parse(user.locked_until)>now()))return null;
      const secret=await vault.read(user.id),step=Math.floor(now()/30000);
      let matched=-1;
      for(const candidate of [step-1,step,step+1])if(candidate>Number(user.last_totp_step)&&safeEqual(totp(secret.totp,candidate*30000),input.code))matched=candidate;
      if(!await validPassword(input.password,user.password_hash)||matched<0){
        const failures=user.failed_count+1;
        await tx.query('UPDATE studio_users SET failed_count=$2,locked_until=$3 WHERE id=$1',[user.id,failures,failures>=8?new Date(now()+10*60000).toISOString():null]);return null;
      }
      await tx.query('UPDATE studio_users SET last_totp_step=$2,failed_count=0,locked_until=NULL WHERE id=$1',[user.id,matched]);return user;
    });
    if(!result)studioFail(401,'STUDIO_LOGIN_REJECTED','账号、密码或验证码不正确，或暂时不可用。');return result!;
  }
  return {
    async login(raw:unknown){
      const user=await verifyCredentials(raw),value=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
      await db.transaction(async tx=>{
        const active=(await tx.query('SELECT id FROM studio_users WHERE id=$1 AND enabled=true FOR SHARE',[user.id])).rows[0];if(!active)studioFail(401,'STUDIO_UNAUTHENTICATED','请重新登录内容工作台。');
        await tx.query('INSERT INTO studio_sessions VALUES($1,$2,$3,$4,$5)',[digest(value),user.id,csrf,new Date(now()+2*3600000).toISOString(),new Date(now()).toISOString()]);
      });return {value,csrf};
    },
    async authenticate(token?:string):Promise<StudioPrincipal|null>{
      if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
      return (await db.query<StudioPrincipal>('SELECT u.id,u.name,u.role,s.csrf,s.token_hash,s.mfa_at FROM studio_sessions s JOIN studio_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.enabled=true',[digest(token),new Date(now()).toISOString()])).rows[0]??null;
    },
    async current(tx:Queryable,p:StudioPrincipal,roles:StudioRole[],sensitive=false){
      const fresh=(await tx.query<StudioPrincipal>('SELECT u.id,u.name,u.role,s.csrf,s.token_hash,s.mfa_at FROM studio_sessions s JOIN studio_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.enabled=true FOR SHARE OF u,s',[p.token_hash,new Date(now()).toISOString()])).rows[0];
      if(!fresh||fresh.id!==p.id)studioFail(401,'STUDIO_UNAUTHENTICATED','请重新登录内容工作台。');
      if(!roles.includes(fresh!.role))studioFail(403,'STUDIO_ROLE_REQUIRED','当前工作职责不能执行这项操作。');
      if(sensitive&&now()-new Date(fresh!.mfa_at).getTime()>10*60000)studioFail(403,'STUDIO_REAUTH_REQUIRED','请重新验证密码和动态验证码，再完成审核或发布。');
      return fresh!;
    },
    async reauth(p:StudioPrincipal,raw:unknown){await verifyCredentials(raw,p.id);await db.query('UPDATE studio_sessions SET mfa_at=$2 WHERE token_hash=$1',[p.token_hash,new Date(now()).toISOString()]);return {ok:true};},
    async logout(p:StudioPrincipal){await db.query('DELETE FROM studio_sessions WHERE token_hash=$1',[p.token_hash]);},
    async sign(p:StudioPrincipal,body:unknown){const secret=await vault.read(p.id);const key=await crypto.subtle.importKey('jwk',secret.signingKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);return signObject(body,'studio-'+p.id,key);},
  };
}
export type StudioAuth=ReturnType<typeof studioAuth>;
