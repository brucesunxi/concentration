import { useEffect,useMemo,useState } from 'react';
import { FamilyMembersClient } from './family-members-client.ts';
import type { MemberRequest,MembersState } from './family-members-client.ts';
export function useFamilyMembers(familyId:string,viewerId:string,request:MemberRequest){
  const [state,setState]=useState<MembersState>({data:null,busy:true,error:'',code:null,needsLogin:false});
  const client=useMemo(()=>new FamilyMembersClient(familyId,viewerId,request,setState),[familyId,viewerId,request]);
  useEffect(()=>{void client.load();return()=>client.dispose();},[client]);
  return {state,reload:()=>client.load(),command:client.command.bind(client)};
}
