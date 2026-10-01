import {useEffect,useRef,useState} from 'react';
import {RecoveryClient} from './recovery-client.ts';
import type {RecoveryRequest,RecoveryState} from './recovery-client.ts';
import type {RecoveryItem} from './recovery-model.ts';
export function useRecovery(childId:string,request:RecoveryRequest,device:()=>Promise<string>,uuid:()=>string){
 const current=useRef<RecoveryClient|null>(null),[state,setState]=useState<RecoveryState>({data:null,busy:true,error:'',saved:false});
 useEffect(()=>{const client=new RecoveryClient(childId,request,device,uuid,setState);current.current=client;setState({...client.state,busy:true});void client.load();return()=>{client.dispose();if(current.current===client)current.current=null}},[childId,request,device,uuid]);
 return {state,reload:()=>current.current?.load(),handover:(item:RecoveryItem)=>current.current?.handover(item),resume:(item:RecoveryItem,run:(id:string)=>Promise<void>)=>current.current?.resume(item,run)};
}
