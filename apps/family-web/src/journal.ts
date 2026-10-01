export { reconcile, highestContiguousSeq } from '../../../packages/session-runtime/index.ts';
import { WebJournal } from '../../../packages/session-runtime/web-journal.ts';
let storage:WebJournal|undefined;
export const journal = () => storage ??= new WebJournal(indexedDB);
export const readJournal = (id:string,childId:string,familyId?:string) => journal().read(id,childId,familyId);
export const writeJournal:WebJournal['write'] = (...args) => journal().write(...args);
export const clearJournal = (id:string) => journal().close(id,true);
/** Explicitly remove this browser's records; a stopped profile is permanently blocked. */
export const clearChildJournals = (childId?:string) => journal().clear(childId);
