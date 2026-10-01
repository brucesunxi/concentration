import type { FamilyMembers } from '../contracts/family-members.ts';
export type MemberRequest = <T>(path:string,method?:string,data?:unknown,headers?:Record<string,string>)=>Promise<T>;
export interface MembersState { data:FamilyMembers|null; busy:boolean; error:string; code:{value:string;expiresAt:string}|null; needsLogin:boolean }
export class FamilyMembersClient {
  state:MembersState={data:null,busy:false,error:'',code:null,needsLogin:false};
  private disposed=false;
  private familyId:string; private viewerId:string; private request:MemberRequest; private changed:(state:MembersState)=>void;
  constructor(familyId:string,viewerId:string,request:MemberRequest,changed:(state:MembersState)=>void){this.familyId=familyId;this.viewerId=viewerId;this.request=request;this.changed=changed;}
  private update(value:Partial<MembersState>){if(!this.disposed){this.state={...this.state,...value};this.changed(this.state);}}
  private async read(){const data=await this.request<FamilyMembers>('/family/members');if(data.version!=='family-members-1'||data.familyId!==this.familyId||data.viewerId!==this.viewerId)throw {code:'MEMBERS_UPDATE_REQUIRED'};return data;}
  private failed(error:unknown,writing=false){const code=(error as {code?:string}).code;this.update({data:null,code:null,error:code??(writing?'RESULT_UNCONFIRMED':'LOAD_FAILED'),needsLogin:['UNAUTHENTICATED','PARENT_REQUIRED','REAUTH_REQUIRED'].includes(code??'')});}
  async load(){if(this.disposed||this.state.busy)return;this.update({busy:true,error:'',code:null});try{this.update({data:await this.read()});}catch(e){this.failed(e);}finally{this.update({busy:false});}}
  async command(kind:'invite'|'cancel'|'approve'|'revoke',input:{id?:string;version?:number;childIds?:string[];key?:string}){
    if(this.disposed||this.state.busy||!this.state.data?.canManage)return;
    this.update({busy:true,error:'',code:null});
    try{
      let code:MembersState['code']=null;
      if(kind==='invite'){
        const r=await this.request<{id:string;code:string;expiresAt:string}>('/family/invitations','POST',{childIds:input.childIds,acknowledged:true},{'Idempotency-Key':input.key!});
        if(!/^[a-f0-9]{64}$/.test(r.code)||!Number.isFinite(Date.parse(r.expiresAt)))throw {code:'RESULT_UNCONFIRMED'};
        code={value:r.code,expiresAt:r.expiresAt};
      }else{
        const r=await this.request<{ok:boolean}>(`/family/${kind==='cancel'?'invitations':'members'}/${input.id}`,'POST',kind==='cancel'?{acknowledged:true}:{action:kind,acknowledged:true},kind==='cancel'?{}:{'If-Match':`"${input.version}"`});
        if(!r.ok)throw {code:'RESULT_UNCONFIRMED'};
      }
      this.update({data:await this.read(),code});
    }catch(e){this.failed(e,true);}finally{this.update({busy:false});}
  }
  dispose(){this.disposed=true;this.state={data:null,busy:false,error:'',code:null,needsLogin:false};}
}
