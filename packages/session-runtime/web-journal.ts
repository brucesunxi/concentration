import { hashObject } from '../content/index.ts';
import type { EngineEvent } from '../task-engine/index.ts';
import type { ClockCheckpoint } from './authorization.ts';
import { offlineCapsuleSchema, OfflinePreparationChanged } from './offline-session.ts';
import type { OfflineCapsule, OfflineSaved } from './offline-session.ts';
import { journalExpired, journalExpiringSoon, retentionClock } from './journal-retention.ts';

interface Journal { id: string; childId: string; familyId?: string; events: EngineEvent[]; hash?: string; createdAt: number }
interface Resume extends OfflineSaved { id: string; generation: number }
const stores = ['sessions', 'offline', 'meta', 'blocked', 'closed'];
const singleton = 'current';
const point = (a: ClockCheckpoint, b: ClockCheckpoint): ClockCheckpoint => ({ highest: Math.max(a.highest,b.highest), fault:a.fault??b.fault });

/** Request callbacks keep conditional reads/writes inside an active IDB transaction. */
function reads<T extends unknown[] = any[]>(tx: IDBTransaction, queries: [string, IDBValidKey][], use: (values: T) => void, fail: (error: unknown) => void) {
  let pending = queries.length; const values: unknown[] = [];
  queries.forEach(([store,key],i)=>{
    const request=tx.objectStore(store).get(key);
    request.onsuccess=()=>{ values[i]=request.result; if(--pending===0)try{use(values as T);}catch(error){fail(error);tx.abort();} };
  });
}

export class WebJournal {
  private connection?: Promise<IDBDatabase>;
  private factory:IDBFactory;
  private name:string;
  private now:()=>number;
  constructor(factory:IDBFactory,name='focus-family-journal',now:()=>number=Date.now){this.factory=factory;this.name=name;this.now=now;}
  private open() {
    return this.connection ??= new Promise<IDBDatabase>((resolve,reject)=>{
      const request=this.factory.open(this.name,3);let blocked=false;
      request.onupgradeneeded=(event)=>{
        const db=request.result;
        for(const name of stores)if(!db.objectStoreNames.contains(name)){
          db.createObjectStore(name,{keyPath:'id'});
          if(name==='meta')request.transaction!.objectStore('meta').put({id:singleton,generation:0,retentionHighWater:this.now()});
        }
        // Existing v1/v2 journals have no reliable creation time. Start their
        // conservative seven-day window at upgrade instead of deleting them.
        if(event.oldVersion<3){
          const cursor=request.transaction!.objectStore('sessions').openCursor();
          cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(!Number.isFinite(row.value.createdAt))row.update({...row.value,createdAt:this.now()});row.continue();};
        }
      };
      request.onsuccess=()=>{ const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();this.connection=undefined;};resolve(db); };
      request.onerror=()=>{this.connection=undefined;reject(request.error);};
      request.onblocked=()=>{blocked=true;this.connection=undefined;reject(new Error('LOCAL_DATABASE_IN_USE'));};
    });
  }
  private async transaction<T>(names:string[],mode:IDBTransactionMode,run:(tx:IDBTransaction,result:(value:T)=>void,fail:(e:unknown)=>void)=>void) {
    const db=await this.open();
    return new Promise<T>((resolve,reject)=>{
      const tx=db.transaction(names,mode);let value:T, failure:unknown;
      tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(failure??tx.error??new Error('LOCAL_TRANSACTION_ABORTED'));
      tx.onerror=()=>{failure??=tx.error;};
      try{run(tx,v=>{value=v;},e=>{failure=e;});}catch(e){failure=e;tx.abort();}
    });
  }
  async generation() {
    await this.prune();
    return this.transaction<number>(['meta'],'readonly',(tx,done,fail)=>reads(tx,[['meta',singleton]],([meta])=>done(meta.generation),fail));
  }
  /** Delete expired event data and seal its session so a stale page cannot restore it. */
  async prune():Promise<number> {
    return this.transaction<number>(stores,'readwrite',(tx,done,fail)=>reads(tx,[['meta',singleton],['offline',singleton]],([meta,resume]:[any,Resume|undefined])=>{
      const effectiveNow=retentionClock(this.now(),meta.retentionHighWater);
      tx.objectStore('meta').put({...meta,retentionHighWater:effectiveNow});
      const cursor=tx.objectStore('sessions').openCursor();
      cursor.onerror=()=>fail(cursor.error);
      cursor.onsuccess=()=>{
        const row=cursor.result;
        if(!row){done(effectiveNow);return;}
        const journal=row.value as Journal;
        if(journalExpired(journal.createdAt,effectiveNow)){
          row.delete();
          tx.objectStore('closed').put({id:journal.id,final:true,reason:'retention'});
          if(resume?.capsule.session.id===journal.id)tx.objectStore('offline').clear();
        }
        row.continue();
      };
    },fail));
  }
  async expiringSoon(familyId:string,childId:string):Promise<number> {
    const effectiveNow=await this.prune();
    return this.transaction<number>(['sessions'],'readonly',(tx,done,fail)=>{
      let count=0;const cursor=tx.objectStore('sessions').openCursor();
      cursor.onerror=()=>fail(cursor.error);
      cursor.onsuccess=()=>{const row=cursor.result;if(!row){done(count);return;}const journal=row.value as Journal;
        if(journal.familyId===familyId&&journal.childId===childId&&journalExpiringSoon(journal.createdAt,effectiveNow))count++;
        row.continue();};
    });
  }
  async invalidate() {
    await this.transaction<void>(['meta','offline'],'readwrite',(tx,done,fail)=>reads(tx,[['meta',singleton]],([meta])=>{
      tx.objectStore('meta').put({...meta,generation:meta.generation+1});tx.objectStore('offline').clear();done();
    },fail));
  }
  /** Stop stale writes from one family's tabs without invalidating another family's recovery. */
  async invalidateFamily(familyId:string,childIds:string[]) {
    const children=new Set(childIds);
    await this.transaction<void>(['meta','offline'],'readwrite',(tx,done,fail)=>reads(tx,[['meta',singleton],['offline',singleton]],([meta,resume]:[any,Resume|undefined])=>{
      const generation=meta.generation+1;
      tx.objectStore('meta').put({...meta,generation});
      if(resume){
        if(resume.capsule.familyId===familyId||children.has(resume.capsule.session.child_id))tx.objectStore('offline').clear();
        else if(resume.generation===meta.generation)tx.objectStore('offline').put({...resume,generation});
      }
      done();
    },fail));
  }
  async read(id:string,childId:string,familyId?:string):Promise<EngineEvent[]> {
    await this.prune();
    return this.transaction(['sessions'],'readonly',(tx,done,fail)=>reads(tx,[['sessions',id]],([journal]:[Journal|undefined])=>{
      if(journal&&(journal.childId!==childId || (familyId&&journal.familyId&&journal.familyId!==familyId)))throw new Error('LOCAL_OWNER_MISMATCH');
      done(journal?.events??[]);
    },fail));
  }
  async write(id:string,childId:string,familyId:string,events:EngineEvent[],generation:number,checkpoint?:ClockCheckpoint) {
    const effectiveNow=await this.prune();
    events=structuredClone(events);
    const hash=await hashObject(events);
    await this.transaction<void>(stores,'readwrite',(tx,done,fail)=>reads(tx,[['sessions',id],['meta',singleton],['blocked',childId],['closed',id],['offline',singleton]],([prior,meta,blocked,closed,resume]:[Journal|undefined,any,any,any,Resume|undefined])=>{
      if(meta.generation!==generation||blocked||closed?.final)throw new OfflinePreparationChanged();
      if(prior&&(prior.childId!==childId||(prior.familyId&&prior.familyId!==familyId)))throw new Error('LOCAL_OWNER_MISMATCH');
      tx.objectStore('sessions').put({id,childId,familyId,events,hash,createdAt:prior?.createdAt??effectiveNow} satisfies Journal);
      if(resume?.capsule.session.id===id&&resume.generation===generation){
        if(resume.capsule.familyId!==familyId||resume.capsule.session.child_id!==childId)throw new Error('LOCAL_OWNER_MISMATCH');
        tx.objectStore('offline').put({...resume,journalHash:hash,checkpoint:checkpoint?point(resume.checkpoint,checkpoint):resume.checkpoint});
      }
      done();
    },fail));
  }
  async prepare(raw:OfflineCapsule,generation:number,checkpoint:ClockCheckpoint,events:EngineEvent[]) {
    await this.prune();
    const capsule=structuredClone(offlineCapsuleSchema.parse(raw)),hash=await hashObject(events),id=capsule.session.id,childId=capsule.session.child_id;
    if(capsule.session.plan.environment?.platform!=='web')throw new Error('WEB_PLAN_REQUIRED');
    await this.transaction<void>(stores,'readwrite',(tx,done,fail)=>reads(tx,[['sessions',id],['meta',singleton],['blocked',childId],['closed',id],['offline',singleton]],([journal,meta,blocked,closed,prior]:[Journal|undefined,any,any,any,Resume|undefined])=>{
      if(meta.generation!==generation||blocked||closed||!journal||journal.childId!==childId||journal.familyId!==capsule.familyId||journal.hash!==hash)throw new OfflinePreparationChanged();
      tx.objectStore('offline').put({id:singleton,generation,capsule,journalHash:hash,checkpoint:prior?.capsule.session.id===id?point(prior.checkpoint,checkpoint):checkpoint} satisfies Resume);done();
    },fail));
  }
  async checkpoint(id:string,checkpoint:ClockCheckpoint) {
    await this.transaction<void>(['meta','offline'],'readwrite',(tx,done,fail)=>reads(tx,[['meta',singleton],['offline',singleton]],([meta,resume]:[any,Resume|undefined])=>{
      if(resume?.capsule.session.id===id&&resume.generation===meta.generation)tx.objectStore('offline').put({...resume,checkpoint:point(resume.checkpoint,checkpoint)});
      done();
    },fail));
  }
  async resume():Promise<(OfflineSaved&{events:EngineEvent[];generation:number})|null> {
    await this.prune();
    return this.transaction(stores,'readonly',(tx,done,fail)=>reads(tx,[['meta',singleton],['offline',singleton]],([meta,resume]:[any,Resume|undefined])=>{
      if(!resume||resume.generation!==meta.generation){done(null);return;}
      const capsule=offlineCapsuleSchema.parse(resume.capsule);
      reads(tx,[['sessions',capsule.session.id],['blocked',capsule.session.child_id],['closed',capsule.session.id]],([journal,blocked,closed]:[Journal|undefined,any,any])=>{
        if(blocked||closed||!journal||journal.familyId!==capsule.familyId||journal.childId!==capsule.session.child_id){done(null);return;}
        done({capsule,checkpoint:resume.checkpoint,journalHash:resume.journalHash,events:journal.events,generation:resume.generation});
      },fail);
    },fail));
  }
  /** An expired recording grant still permits honest closure/history upload. */
  async close(id:string,removeJournal=false) {
    await this.transaction<void>(['offline','closed','sessions'],'readwrite',(tx,done,fail)=>reads(tx,[['offline',singleton],['closed',id]],([resume,prior]:[Resume|undefined,{final?:boolean}|undefined])=>{
      tx.objectStore('closed').put({id,final:removeJournal||prior?.final===true});
      if(resume?.capsule.session.id===id)tx.objectStore('offline').clear();
      if(removeJournal)tx.objectStore('sessions').delete(id);done();
    },fail));
  }
  async clear(childId?:string) {
    await this.transaction<void>(stores,'readwrite',(tx,done,fail)=>reads(tx,[['meta',singleton]],([meta])=>{
      tx.objectStore('meta').put({...meta,generation:meta.generation+1});tx.objectStore('offline').clear();
      if(!childId)tx.objectStore('sessions').clear();
      else {
        tx.objectStore('blocked').put({id:childId});
        const cursor=tx.objectStore('sessions').openCursor();
        cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if((row.value as Journal).childId===childId)row.delete();row.continue();};
      }
      done();
    },fail));
  }
  /** Remove one family's recoverable data on a browser shared by several families. */
  async clearFamily(familyId:string,childIds:string[]) {
    const children=new Set(childIds);
    await this.transaction<void>(stores,'readwrite',(tx,done,fail)=>reads(tx,[['meta',singleton],['offline',singleton]],([meta,resume]:[any,Resume|undefined])=>{
      const generation=meta.generation+1;
      tx.objectStore('meta').put({...meta,generation});
      if(resume){
        if(resume.capsule.familyId===familyId||children.has(resume.capsule.session.child_id))tx.objectStore('offline').clear();
        else if(resume.generation===meta.generation)tx.objectStore('offline').put({...resume,generation});
      }
      for(const id of children)tx.objectStore('blocked').put({id});
      const cursor=tx.objectStore('sessions').openCursor();
      cursor.onerror=()=>{fail(cursor.error);tx.abort();};
      cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;const journal=row.value as Journal;
        if(journal.familyId===familyId||children.has(journal.childId))row.delete();
        row.continue();};
      done();
    },fail));
  }
}
