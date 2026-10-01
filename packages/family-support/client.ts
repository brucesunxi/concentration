import type { GoalInput, GoalAction, GoalReply, LifeGoal } from './model.ts';
import {REFLECTION_SHARING_POLICY, openGoal} from './model.ts';
import { LIFE_HISTORY_VERSION, LIFE_HISTORY_PAGE_SIZE } from './history.ts';
import type { LifeHistorySpace } from './history.ts';

export type LifeRequest = <T>(path: string, method?: string, data?: unknown, headers?: Record<string, string>) => Promise<T>;
export interface LifeClientState { data: LifeHistorySpace | null; busy: boolean; error: string; saved: boolean; historyPage: number; paging: boolean; historyError: string }
export const initialLifeState = (): LifeClientState => ({data:null,busy:false,error:'',saved:false,historyPage:1,paging:false,historyError:''});
const accessErrors = ['UNAUTHENTICATED','NOT_FOUND','ACCESS_CHANGED','CHILD_REQUIRED','PARENT_REQUIRED','OWNER_REQUIRED','MEMBER_PENDING','REAUTH_REQUIRED'];
export class LifeClient {
  state = initialLifeState();
  private positions: (string | undefined)[] = [undefined];
  private readRevision = 0;
  private refreshing = false;
  private disposed = false;
  private attempt: { fingerprint: string; key: string } | null = null;
  readonly childId: string;
  readonly role: 'parent' | 'child';
  private request: LifeRequest;
  private id: () => string;
  private changed: (state: LifeClientState) => void;
  constructor(childId: string, role: 'parent' | 'child', request: LifeRequest, id: () => string, changed: (state: LifeClientState) => void) {
    this.childId = childId; this.role = role; this.request = request; this.id = id; this.changed = changed;
  }
  private update(patch: Partial<LifeClientState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.changed(this.state); } }
  private path() { return `/children/${this.childId}/life-goals`; }
  private readPath(positions = this.positions) { const cursor=positions.at(-1);return `${this.path()}/history${cursor?'?cursor='+encodeURIComponent(cursor):''}`; }
  private check(data: LifeHistorySpace) {
    if(data?.contentPolicy!=='family-content-1'||!data.content||!data.releases)throw new Error('FAMILY_CONTENT_UPDATE_REQUIRED');
    if(data.sharingPolicy!==REFLECTION_SHARING_POLICY)throw new Error('SHARING_UPDATE_REQUIRED');
    if (data.childId !== this.childId || data.role !== this.role || !Array.isArray(data.goals) || data.goals.some(g => g.childId !== this.childId)) throw new Error('ACCESS_CHANGED');
    const cursor=data.history?.nextCursor,open=data.goals.filter(openGoal);
    if(data.history?.version!==LIFE_HISTORY_VERSION || data.history.pageSize!==LIFE_HISTORY_PAGE_SIZE || open.length>1 || data.goals.length-open.length>LIFE_HISTORY_PAGE_SIZE || new Set(data.goals.map(g=>g.id)).size!==data.goals.length || !(cursor===null || typeof cursor==='string'&&/^[A-Za-z0-9_-]{1,512}$/.test(cursor)))throw new Error('LIFE_HISTORY_UPDATE_REQUIRED');
    return data;
  }
  private errorCode(error: unknown) { return (error as { code?: string })?.code ?? (error instanceof Error && ['ACCESS_CHANGED','SHARING_UPDATE_REQUIRED','FAMILY_CONTENT_UPDATE_REQUIRED','LIFE_HISTORY_UPDATE_REQUIRED'].includes(error.message) ? error.message : 'REQUEST_FAILED'); }
  // Periodic reads retain the current page. Only an explicit latest-read resets it.
  async load(latest = false) {
    if (this.disposed || this.state.busy) return false;
    this.readRevision++;
    const positions=latest?[undefined]:this.positions;
    this.update({ busy: true, error: '', saved: false, historyError:'' });
    try {
      const data=this.check(await this.request<LifeHistorySpace>(this.readPath(positions)));
      if(this.disposed)return false;
      this.positions=positions;this.update({data,historyPage:positions.length});return true;
    }
    catch (error) { const code = this.errorCode(error); this.update({ error: code === 'REQUEST_FAILED' ? 'LOAD_FAILED' : code, data: null });return false; }
    finally { this.update({ busy: false }); }
  }
  async refreshBackground() {
    if(this.disposed || this.state.busy || !this.state.data || this.refreshing)return;
    const revision=this.readRevision;
    this.refreshing=true;
    try {
      const data=this.check(await this.request<LifeHistorySpace>(this.readPath()));
      if(!this.disposed&&revision===this.readRevision)this.update({data});
    } catch(error) {
      if(!this.disposed&&revision===this.readRevision){const code=this.errorCode(error);this.update({data:null,error:code==='REQUEST_FAILED'?'LOAD_FAILED':code});}
    } finally {this.refreshing=false;}
  }
  async move(direction:'older'|'newer') {
    if(this.disposed || this.state.busy || !this.state.data)return false;
    const cursor=this.state.data.history.nextCursor;
    if(direction==='older'&&!cursor || direction==='newer'&&this.positions.length===1)return false;
    const positions=direction==='older'?[...this.positions,cursor!]:this.positions.slice(0,-1);
    this.readRevision++;
    this.update({busy:true,paging:true,historyError:'',error:'',saved:false});
    try {
      const data=this.check(await this.request<LifeHistorySpace>(this.readPath(positions)));
      if(this.disposed)return false;
      this.positions=positions;this.update({data,historyPage:positions.length});return true;
    } catch(error) {
      const code=this.errorCode(error),clear=accessErrors.includes(code)||code.endsWith('UPDATE_REQUIRED');
      this.update(clear?{data:null,error:code}:{historyError:code==='REQUEST_FAILED'?'LIFE_HISTORY_PAGE_FAILED':code});return false;
    } finally {this.update({busy:false,paging:false});}
  }
  create(input: Omit<GoalInput, 'intent'|'contentHash'>) { if(this.state.data?.content.state!=='available'||!this.state.data.content.hash)return; return this.mutate('POST', this.path(), { ...input,contentHash:this.state.data.content.hash, intent: this.role === 'parent' ? 'suggest' : 'choose' }); }
  act(goal: LifeGoal, input: GoalAction) { return this.mutate('PATCH', `${this.path()}/${goal.id}`, input, goal.version,input.action==='unshare'); }
  private async mutate(method: string, path: string, input: unknown, version?: number,removingAnswers=false) {
    if (this.disposed || this.state.busy || !this.state.data || (!this.state.data.collectionActive&&!removingAnswers)) return;
    this.readRevision++;
    const fingerprint = JSON.stringify({ method, path, input, version });
    if (this.attempt?.fingerprint !== fingerprint) this.attempt = { fingerprint, key: this.id() };
    const headers: Record<string, string> = { 'Idempotency-Key': this.attempt.key, ...(version ? { 'If-Match': `"${version}"` } : {}) };
    this.update({ busy: true, error: '', saved: false, historyError:'' });
    try {
      const { goal } = await this.request<GoalReply>(path, method, input, headers);
      if (this.disposed) return;
      if (goal.childId !== this.childId) throw new Error('ACCESS_CHANGED');
      const data = this.state.data!;
      const prior = data.goals.find(g => g.id === goal.id);
      if (prior && goal.version < prior.version) throw new Error('ACCESS_CHANGED');
      this.attempt = null;
      // Other devices may have completed or created goals since this view loaded.
      // Acknowledge the write, then read the authoritative history and count.
      // Removing answers in an older record stays on that page. New/closed goals
      // return to the latest history; a failed refresh never shows stale answers.
      if(!removingAnswers)this.positions=[undefined];
      try { this.update({ data: this.check(await this.request<LifeHistorySpace>(this.readPath())), saved: true, historyPage:this.positions.length }); }
      catch (error) {
        const code = this.errorCode(error);
        this.update({ data: null, saved: true, error: code === 'REQUEST_FAILED' ? 'REFRESH_REQUIRED' : code });
      }
    } catch (error) {
      const code = this.errorCode(error);
      if (['GOAL_CONFLICT', 'GOAL_EXISTS', 'GOAL_CLOSED', 'CONSENT_REVOKED','REFLECTION_WITHDRAWN','REFLECTION_NOT_SHARED','FAMILY_CONTENT_CHANGED','FAMILY_CONTENT_RECALLED','FAMILY_CONTENT_EXPIRED','FAMILY_CONTENT_UNAVAILABLE'].includes(code) && !this.disposed) {
        this.attempt = null;
        // Fetch the winning choice, never apply the stale intent automatically.
        try { this.update({ data: this.check(await this.request<LifeHistorySpace>(this.readPath())) }); } catch { this.update({ data: null }); }
      } else if (accessErrors.includes(code)||code.endsWith('UPDATE_REQUIRED')) this.update({ data: null });
      this.update({ error: code });
    } finally { this.update({ busy: false }); }
  }
  dispose() { this.disposed = true; this.attempt = null; }
}
