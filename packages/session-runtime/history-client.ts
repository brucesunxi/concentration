import type { Report } from '../contracts/models.ts';
import { HISTORY_PAGE_SIZE } from '../contracts/history.ts';
import type { HistoryKind } from '../contracts/history.ts';

export interface HistoryState { data: Report | null; busy: boolean; error: string; needsParent: boolean; pages: Record<HistoryKind,number>; target: HistoryKind | null }
export const initialHistoryState = (): HistoryState => ({data:null,busy:false,error:'',needsParent:false,pages:{sessions:1,observations:1},target:null});
type Positions = Record<HistoryKind,(string | undefined)[]>;
const first = (): Positions => ({sessions:[undefined],observations:[undefined]});
const accessErrors = ['UNAUTHENTICATED','PARENT_REQUIRED','REAUTH_REQUIRED','MEMBER_PENDING','NOT_FOUND','OWNER_REQUIRED'];

/** Owns one profile's two bounded pages. Never stores the full record history. */
export class HistoryClient {
  state = initialHistoryState();
  private positions = first();
  private disposed = false;
  private childId: string;
  private request: <T>(path:string)=>Promise<T>;
  private changed: (value:HistoryState)=>void;
  constructor(childId:string,request:<T>(path:string)=>Promise<T>,changed:(value:HistoryState)=>void) { this.childId=childId;this.request=request;this.changed=changed; }
  private update(value:Partial<HistoryState>) { if(!this.disposed){this.state={...this.state,...value};this.changed(this.state);} }
  private check(value:Report) {
    if(value?.child?.id!==this.childId || value.history?.version!=='family-history-1' || value.history.pageSize!==HISTORY_PAGE_SIZE)throw new Error('HISTORY_UNSUPPORTED');
    for(const kind of ['sessions','observations'] as const) {
      const cursor=value.history[kind]?.nextCursor;
      if(!Array.isArray(value[kind]) || value[kind].length>HISTORY_PAGE_SIZE || new Set(value[kind].map(r=>r.id)).size!==value[kind].length || !(cursor===null || (typeof cursor==='string' && /^[A-Za-z0-9_-]{1,512}$/.test(cursor))))throw new Error('HISTORY_UNSUPPORTED');
    }
    return value;
  }
  private async read(positions:Positions,target:HistoryKind|null=null) {
    if(this.disposed || this.state.busy)return false;
    this.update({busy:true,error:'',needsParent:false,target});
    const query=Object.entries(positions).flatMap(([kind,stack])=>stack.at(-1)?[`${kind}Cursor=${encodeURIComponent(stack.at(-1)!)}`]:[]).join('&');
    try {
      const data=this.check(await this.request<Report>(`/children/${this.childId}/report${query?'?'+query:''}`));
      if(this.disposed)return false;
      this.positions=positions;
      this.update({data,pages:{sessions:positions.sessions.length,observations:positions.observations.length}});return true;
    } catch(error) {
      const code=(error as {code?:string}).code ?? ((error as Error).message==='HISTORY_UNSUPPORTED'?'HISTORY_UNSUPPORTED':'LOAD_FAILED');
      const denied=accessErrors.includes(code);
      // A transient failure preserves the displayed page and its position.
      // Access loss or a mismatched response must clear private information.
      this.update({error:code,...(denied || code==='HISTORY_UNSUPPORTED'?{data:null}:{}),needsParent:denied});return false;
    } finally { this.update({busy:false}); }
  }
  refresh() { return this.read(first()); }
  async move(kind:HistoryKind,direction:'older'|'newer') {
    if(!this.state.data)return false;
    const stack=this.positions[kind],cursor=this.state.data.history[kind].nextCursor;
    if(direction==='older' && !cursor || direction==='newer' && stack.length===1)return false;
    return this.read({...this.positions,[kind]:direction==='older'?[...stack,cursor!]:stack.slice(0,-1)},kind);
  }
  dispose() { this.disposed=true; }
}
