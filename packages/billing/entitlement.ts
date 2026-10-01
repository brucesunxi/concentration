import { z } from 'zod';

const identifier=z.string().min(1).max(200);
const source=z.object({provider:z.enum(['app-store','google-play','web']),originalTransactionId:identifier}).strict();
const base={eventId:identifier,source};
const period=z.object({...base,kind:z.literal('period'),transactionId:identifier,productId:identifier,startsAt:z.iso.datetime(),endsAt:z.iso.datetime()}).strict();
const refund=z.object({...base,kind:z.literal('refund'),transactionId:identifier}).strict();
const renewal=z.object({...base,kind:z.literal('renewal'),revision:z.number().int().nonnegative(),enabled:z.boolean()}).strict();
const grace=z.object({...base,kind:z.literal('grace'),revision:z.number().int().nonnegative(),productId:identifier,until:z.iso.datetime().nullable()}).strict();

/** Only a server adapter may create one of these after verifying provider facts. */
export const verifiedBillingFactSchema=z.discriminatedUnion('kind',[period,refund,renewal,grace]);
export type VerifiedBillingFact=z.infer<typeof verifiedBillingFactSchema>;
export type BillingSource=z.infer<typeof source>;
export interface BillingLedger {
  version:1;
  source:BillingSource;
  seen:Record<string,string>;
  periods:Record<string,{transactionId:string;productId:string;startsAt:string;endsAt:string}>;
  refunded:Record<string,true>;
  renewal:{revision:number;enabled:boolean}|null;
  grace:{revision:number;productId:string;until:string|null}|null;
}
export const billingLedgerSchema:z.ZodType<BillingLedger>=z.object({
  version:z.literal(1),source,seen:z.record(z.string(),z.string()),
  periods:z.record(z.string(),z.object({transactionId:identifier,productId:identifier,startsAt:z.iso.datetime(),endsAt:z.iso.datetime()}).strict()),
  refunded:z.record(z.string(),z.literal(true)),
  renewal:z.object({revision:z.number().int().nonnegative(),enabled:z.boolean()}).strict().nullable(),
  grace:z.object({revision:z.number().int().nonnegative(),productId:identifier,until:z.iso.datetime().nullable()}).strict().nullable(),
}).strict();
export class BillingConflict extends Error { readonly code:string;constructor(code:string){super(code);this.code=code;} }
const key=(value:BillingSource)=>`${value.provider}:${value.originalTransactionId}`;
export function emptyBillingLedger(raw:BillingSource):BillingLedger {return {version:1,source:source.parse(raw),seen:{},periods:{},refunded:{},renewal:null,grace:null};}

/** Replay verified facts without letting retries or late purchases undo a refund. */
export function applyVerifiedBillingFact(current:BillingLedger,raw:unknown):BillingLedger {
  const fact=verifiedBillingFactSchema.parse(raw);
  if(key(current.source)!==key(fact.source))throw new BillingConflict('BILLING_SOURCE_MISMATCH');
  const fingerprint=JSON.stringify(fact),seen=Object.hasOwn(current.seen,fact.eventId)?current.seen[fact.eventId]:undefined;
  if(seen){if(seen!==fingerprint)throw new BillingConflict('BILLING_EVENT_CONFLICT');return current;}
  const next:BillingLedger={...current,seen:{...current.seen,[fact.eventId]:fingerprint},periods:{...current.periods},refunded:{...current.refunded},renewal:current.renewal,grace:current.grace};
  if(fact.kind==='period'){
    if(Date.parse(fact.startsAt)>=Date.parse(fact.endsAt))throw new BillingConflict('BILLING_PERIOD_INVALID');
    const value={transactionId:fact.transactionId,productId:fact.productId,startsAt:fact.startsAt,endsAt:fact.endsAt};
    const prior=Object.hasOwn(next.periods,fact.transactionId)?next.periods[fact.transactionId]:undefined;
    if(prior&&(prior.productId!==value.productId||prior.startsAt!==value.startsAt||prior.endsAt!==value.endsAt))throw new BillingConflict('BILLING_TRANSACTION_CONFLICT');
    next.periods={...next.periods,[fact.transactionId]:value};
  } else if(fact.kind==='refund')next.refunded={...next.refunded,[fact.transactionId]:true};
  else if(fact.kind==='renewal'){
    const prior=next.renewal;
    if(prior?.revision===fact.revision&&prior.enabled!==fact.enabled)throw new BillingConflict('BILLING_REVISION_CONFLICT');
    if(!prior||fact.revision>prior.revision)next.renewal={revision:fact.revision,enabled:fact.enabled};
  } else {
    const prior=next.grace,value={revision:fact.revision,productId:fact.productId,until:fact.until};
    if(prior?.revision===fact.revision&&JSON.stringify(prior)!==JSON.stringify(value))throw new BillingConflict('BILLING_REVISION_CONFLICT');
    if(!prior||fact.revision>prior.revision)next.grace=value;
  }
  return next;
}

export type Entitlement={state:'active'|'grace'|'expired'|'refunded'|'free';productId:string|null;validUntil:string|null;autoRenew:boolean|null};
export function entitlementAt(ledgers:BillingLedger[],at:string):Entitlement {
  const time=Date.parse(z.iso.datetime().parse(at));
  const active=ledgers.flatMap(ledger=>Object.values(ledger.periods).filter(period=>!Object.hasOwn(ledger.refunded,period.transactionId)&&Date.parse(period.startsAt)<=time&&time<Date.parse(period.endsAt))
    .map(period=>({productId:period.productId,validUntil:period.endsAt,autoRenew:ledger.renewal?.enabled??null})));
  active.sort((a,b)=>Date.parse(b.validUntil)-Date.parse(a.validUntil));
  if(active[0])return {state:'active',...active[0]};
  const grace=ledgers.filter(ledger=>Object.values(ledger.periods).some(period=>!Object.hasOwn(ledger.refunded,period.transactionId)&&period.productId===ledger.grace?.productId&&Date.parse(period.startsAt)<=time)&&ledger.grace?.until&&time<Date.parse(ledger.grace.until))
    .map(ledger=>({productId:ledger.grace!.productId,validUntil:ledger.grace!.until!,autoRenew:ledger.renewal?.enabled??null}));
  grace.sort((a,b)=>Date.parse(b.validUntil)-Date.parse(a.validUntil));
  if(grace[0])return {state:'grace',...grace[0]};
  const periods=ledgers.flatMap(ledger=>Object.values(ledger.periods).map(period=>({refunded:Object.hasOwn(ledger.refunded,period.transactionId)})));
  return {state:periods.length===0?'free':periods.every(period=>period.refunded)?'refunded':'expired',productId:null,validUntil:null,autoRenew:null};
}
