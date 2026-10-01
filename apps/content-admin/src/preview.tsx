import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {Play} from '../../family-web/src/Play.tsx';
import type {StaffPreviewPort} from '../../family-web/src/Play.tsx';
import type {PlayableContent} from '../../family-web/src/preflight.ts';
import {boundedBytes} from '../../family-web/src/preflight.ts';
import {verifyAsset} from '../../../packages/content/index.ts';
import {verifyCandidatePreview} from '../../../packages/content/preview-client.ts';
import type {CandidatePreview,PreviewReceipt} from '../../../packages/content/preview.ts';
import type {EngineEvent} from '../../../packages/task-engine/index.ts';
import {ErrorBoundary} from '../../family-web/src/ErrorBoundary.tsx';
import '../../family-web/src/style.css';
import './preview.css';

let csrf='';
async function request<T>(path:string,method='GET',data?:unknown):Promise<T>{
  const response=await fetch('/api/studio'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(12000)});
  const value=await response.json();if(!response.ok)throw new Error(value.message??'无法读取试玩。');if(value.csrf)csrf=value.csrf;return value;
}
async function prepare(snapshot:CandidatePreview,signal:AbortSignal):Promise<PlayableContent>{
  const pack=await verifyCandidatePreview(snapshot),urls:Record<string,string>={};
  const dispose=()=>Object.values(urls).forEach(URL.revokeObjectURL);
  try{for(const a of pack.assets){signal.throwIfAborted();const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,20000);
    try{const bytes=await boundedBytes(await fetch('/api/studio/media/'+a.path.split('/').at(-1),{credentials:'same-origin',signal:controller.signal,cache:'no-store'}),a.bytes);await verifyAsset(a,bytes);signal.throwIfAborted();urls[a.id]=URL.createObjectURL(new Blob([bytes],{type:a.mime}));if(a.mime==='image/png'){const image=new Image();image.src=urls[a.id];await image.decode();}}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }signal.throwIfAborted();return {pack,urls,dispose};}catch(error){dispose();throw error;}
}
function PreviewPage(){
  const [loaded,setLoaded]=useState<{snapshot:CandidatePreview;port:StaffPreviewPort}|null>(null),[error,setError]=useState(''),[receipt,setReceipt]=useState<PreviewReceipt|null>(null),[draftId,setDraftId]=useState('');
  useEffect(()=>{
    let active=true;const id=location.pathname.split('/').at(-1)!;
    const channel=new BroadcastChannel('focus-studio-access');channel.onmessage=()=>{active=false;setLoaded(null);setError('管理身份已变化，请返回工作台重新登录。');};
    void(async()=>{try{
      const me=await request<{user:{id:string}}>('/me'),snapshot=await request<CandidatePreview>('/previews/'+id);if(!active)return;
      if(snapshot.actorId!==me.user.id)throw new Error('当前身份与试玩记录不一致。');await verifyCandidatePreview(snapshot);if(!active)return;setDraftId(snapshot.draftId);
      if(snapshot.receipt){setReceipt(snapshot.receipt);return;}
      const startWall=Date.now(),startMono=performance.now();let observations:EngineEvent[]=[];
      const port:StaffPreviewPort={
        prepare:signal=>prepare(snapshot,signal),
        canContinue:()=>active&&Math.max(Date.now(),startWall+performance.now()-startMono)<Date.parse(snapshot.expiresAt),
        check:async()=>{const current=await request<CandidatePreview>('/previews/'+id);if(!active||current.actorId!==me.user.id||current.packHash!==snapshot.packHash||current.round!==snapshot.round)throw new Error('试玩身份或内容已变化。');},
        save:async events=>{if(!active)throw new Error('Preview identity changed');observations=events;},
        finish:async events=>{if(!active||events.length!==observations.length)throw new Error('Preview stopped');const result=await request<PreviewReceipt>('/previews/'+id+'/finish','POST',{events});if(!active)throw new Error('Preview identity changed');if(result.packHash!==snapshot.packHash||result.planHash!==snapshot.planHash)throw new Error('试玩回执与当前版本不一致。');},
      };
      setLoaded({snapshot,port});
    }catch(e){if(active)setError(e instanceof Error?e.message:'无法准备试玩。');}})();
    return()=>{active=false;channel.close();};
  },[]);
  const back='/'+(draftId?'?draft='+encodeURIComponent(draftId):'');
  return <><aside className="preview-banner"><div><strong>团队审核试玩</strong><span>真实任务界面 · 操作只用于审核这一稿，不进入儿童档案</span></div><a href={back}>返回工作台（放弃未核对操作）</a></aside>{error?<section className="preview-message"><h1>试玩已停止</h1><p role="alert">{error}</p><a href={back}>返回内容工作台</a></section>:receipt?<section className="preview-message"><h1>{receipt.complete?'完整试玩已核对':'本次试玩已提前结束'}</h1><p>正式步骤 {receipt.formalTrials} · 技术排除 {receipt.invalidations} · 中断 {receipt.interruptions}</p><p>记录用于核对内容操作，不代表儿童适用性或训练效果。</p><a href={back}>返回这一稿</a></section>:loaded?<><details className="preview-inspector"><summary>本次试玩：第 {loaded.snapshot.round} 稿 · 难度 {loaded.snapshot.plan.level} · {loaded.snapshot.pack.locale} · {loaded.snapshot.pack.ageBand} 岁</summary><dl><dt>冻结内容</dt><dd>{loaded.snapshot.packHash}</dd><dt>计划摘要</dt><dd>{loaded.snapshot.planHash}</dd><dt>种子 / 输入 / 协议</dt><dd>{loaded.snapshot.plan.seed} / {loaded.snapshot.plan.environment?.input} / {loaded.snapshot.plan.version}</dd><dt>范围</dt><dd>包含原有示范和全部正式步骤。时间窗口与家庭 Web 相同，不加速，不跳题。当前页刷新会丢失尚未核对的操作；需要保持联网。</dd></dl></details><Play session={{id:loaded.snapshot.id,child_id:loaded.snapshot.id,plan:loaded.snapshot.plan,budget_ms:loaded.snapshot.budgetMs,state:'active',created_at:loaded.snapshot.createdAt}} familyId="staff-preview" preview={loaded.port} onExit={()=>location.assign(back)}/></>:<section className="preview-message"><p role="status">正在核对候选内容与实际任务计划…</p></section>}</>;
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><PreviewPage/></ErrorBoundary>);
