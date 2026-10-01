import type { RecoverySpace,RecoveryItem,HandoverReceipt } from './recovery-model.ts';
export type RecoveryRequest=<T>(path:string,method?:string,data?:unknown,headers?:Record<string,string>)=>Promise<T>;
export interface RecoveryState { data:RecoverySpace|null;busy:boolean;error:string;saved:boolean }
export class RecoveryClient {
 state:RecoveryState={data:null,busy:false,error:'',saved:false};
 private disposed=false;private installation='';private attempt:{fingerprint:string;key:string}|null=null;
 private childId:string;private request:RecoveryRequest;private device:()=>Promise<string>;private uuid:()=>string;private changed:(state:RecoveryState)=>void;
 constructor(childId:string,request:RecoveryRequest,device:()=>Promise<string>,uuid:()=>string,changed:(state:RecoveryState)=>void){this.childId=childId;this.request=request;this.device=device;this.uuid=uuid;this.changed=changed}
 private update(patch:Partial<RecoveryState>){if(!this.disposed){this.state={...this.state,...patch};this.changed(this.state)}}
 private path(){return `/children/${this.childId}/recovery`}
 private code(e:unknown){return (e as {code?:string})?.code ?? (e instanceof Error && e.message==='ACCESS_CHANGED' ? 'ACCESS_CHANGED':'REQUEST_FAILED')}
 private async read(){
  if(!this.installation)this.installation=await this.device();
  if(this.disposed)throw new Error('ACCESS_CHANGED');
  const data=await this.request<RecoverySpace>(this.path(),'POST',{deviceId:this.installation});
  if(data.childId!==this.childId)throw new Error('ACCESS_CHANGED');
  return data;
 }
 async load(){if(this.disposed||this.state.busy)return;this.update({busy:true,error:'',saved:false});try{this.update({data:await this.read()})}catch(e){this.update({data:null,error:this.code(e)})}finally{this.update({busy:false})}}
 async handover(item:RecoveryItem){
  if(this.disposed||this.state.busy||!this.state.data?.collectionActive||this.state.data.active?.etag!==item.etag||this.state.data.active.id!==item.id||!item.handoverAvailable)return;
  const body={deviceId:this.installation,acknowledged:true},fingerprint=JSON.stringify({id:item.id,body,etag:item.etag});
  if(this.attempt?.fingerprint!==fingerprint)this.attempt={fingerprint,key:this.uuid()};
  this.update({busy:true,error:'',saved:false});
  try{
   const receipt=await this.request<HandoverReceipt>(`${this.path()}/${item.id}/handover`,'POST',body,{'If-Match':item.etag,'Idempotency-Key':this.attempt.key});
   if(this.disposed)return;
   if(receipt.childId!==this.childId||receipt.sessionId!==item.id)throw new Error('ACCESS_CHANGED');
   this.attempt=null;this.update({saved:true,data:null});
   try{this.update({data:await this.read()})}catch(e){this.update({error:this.code(e)==='REQUEST_FAILED'?'REFRESH_REQUIRED':this.code(e)})}
  }catch(e){
   const error=this.code(e);
   if(error==='HANDOVER_CONFLICT'){this.attempt=null;try{this.update({data:await this.read()})}catch{this.update({data:null})}}
   if(['UNAUTHENTICATED','PARENT_REQUIRED','CONSENT_REVOKED','NOT_FOUND','ACCESS_CHANGED'].includes(error))this.update({data:null});
   this.update({error});
  }finally{this.update({busy:false})}
 }
 async resume(item:RecoveryItem,run:(id:string)=>Promise<void>){
  if(this.disposed||this.state.busy||!this.state.data?.collectionActive||!item.sameDevice||item.finalized)return;
  this.update({busy:true,error:'',saved:false});
  try{await run(item.id)}catch(e){const error=this.code(e);this.update({error});if(['UNAUTHENTICATED','PARENT_REQUIRED','NOT_FOUND','ACCESS_CHANGED'].includes(error))this.update({data:null})}finally{this.update({busy:false})}
 }
 dispose(){this.disposed=true;this.attempt=null;this.installation='';this.state={data:null,busy:false,error:'',saved:false}}
}
