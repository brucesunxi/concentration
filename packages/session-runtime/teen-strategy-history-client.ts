import { TASKS } from '../task-engine/index.ts';
import { TEEN_STRATEGY_PAGE_SIZE } from '../contracts/teen-strategy-history.ts';
import type { TeenStrategyHistory } from '../contracts/teen-strategy-history.ts';

export interface TeenStrategyState {
  data: TeenStrategyHistory | null;
  busy: boolean;
  error: string;
  denied: boolean;
  page: number;
}
export const initialTeenStrategyState = (): TeenStrategyState => ({ data: null, busy: false, error: '', denied: false, page: 1 });
const accessErrors = ['UNAUTHENTICATED', 'CHILD_REQUIRED', 'AGE_GROUP_UNAVAILABLE', 'NOT_FOUND', 'MEMBER_PENDING'];

export class TeenStrategyHistoryClient {
  state = initialTeenStrategyState();
  private positions: (string | undefined)[] = [undefined];
  private disposed = false;
  private childId: string;
  private request: <T>(path: string) => Promise<T>;
  private changed: (state: TeenStrategyState) => void;
  constructor(childId: string, request: <T>(path: string) => Promise<T>, changed: (state: TeenStrategyState) => void) {
    this.childId = childId; this.request = request; this.changed = changed;
  }
  private update(value: Partial<TeenStrategyState>) {
    if (!this.disposed) { this.state = { ...this.state, ...value }; this.changed(this.state); }
  }
  private check(value: TeenStrategyHistory) {
    const cursor = value?.nextCursor;
    if (value?.version !== 'teen-strategy-history-1' || value.childId !== this.childId || value.pageSize !== TEEN_STRATEGY_PAGE_SIZE
      || !Array.isArray(value.items) || value.items.length > TEEN_STRATEGY_PAGE_SIZE
      || value.items.some(item => !item || !/^[a-f0-9-]{36}$/.test(item.id) || !TASKS.includes(item.task)
        || !['completed', 'stopped', 'previous-device'].includes(item.status) || !Number.isFinite(Date.parse(item.createdAt))
        || Object.keys(item).sort().join(',') !== 'createdAt,id,status,task')
      || new Set(value.items.map(item => item.id)).size !== value.items.length
      || !(cursor === null || (typeof cursor === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(cursor)))) throw new Error('STRATEGY_HISTORY_UNSUPPORTED');
    return value;
  }
  private async read(positions: (string | undefined)[]) {
    if (this.disposed || this.state.busy) return false;
    this.update({ busy: true, error: '', denied: false });
    try {
      const cursor = positions.at(-1);
      const data = this.check(await this.request<TeenStrategyHistory>(`/children/${this.childId}/strategy-history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`));
      if (this.disposed) return false;
      this.positions = positions;
      this.update({ data, page: positions.length }); return true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code
        : error instanceof Error && error.message === 'STRATEGY_HISTORY_UNSUPPORTED' ? 'STRATEGY_HISTORY_UNSUPPORTED' : 'LOAD_FAILED';
      const denied = accessErrors.includes(code);
      this.update({ error: code, ...(denied || code === 'STRATEGY_HISTORY_UNSUPPORTED' ? { data: null } : {}), denied });
      return false;
    } finally { this.update({ busy: false }); }
  }
  refresh() { return this.read([undefined]); }
  older() { return this.state.data?.nextCursor ? this.read([...this.positions, this.state.data.nextCursor]) : Promise.resolve(false); }
  newer() { return this.positions.length > 1 ? this.read(this.positions.slice(0, -1)) : Promise.resolve(false); }
  dispose() { this.disposed = true; this.state.data = null; }
}
