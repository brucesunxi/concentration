import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVerifiedBillingFact, emptyBillingLedger, entitlementAt, BillingConflict } from '../../packages/billing/index.ts';

const source={provider:'app-store' as const,originalTransactionId:'synthetic-original'};
const start='2026-10-01T00:00:00.000Z',end='2026-11-01T00:00:00.000Z',later='2026-12-01T00:00:00.000Z';
const period=(eventId:string,transactionId:string,startsAt:string,endsAt:string)=>({kind:'period' as const,eventId,source,transactionId,productId:'family-month',startsAt,endsAt});
const refund=(eventId:string,transactionId:string)=>({kind:'refund' as const,eventId,source,transactionId});

test('one verified purchase grants only its paid interval; restoration and duplicate notification do not grant twice',()=>{
  const fact=period('event-1','transaction-1',start,end),first=applyVerifiedBillingFact(emptyBillingLedger(source),fact);
  assert.equal(applyVerifiedBillingFact(first,fact),first);
  const restored=applyVerifiedBillingFact(first,{...fact,eventId:'restored-1'});
  assert.equal(Object.keys(restored.periods).length,1);
  assert.equal(entitlementAt([restored],'2026-10-15T00:00:00.000Z').state,'active');
  assert.equal(entitlementAt([restored],end).state,'expired');
  assert.throws(()=>applyVerifiedBillingFact(restored,{...fact,endsAt:later}),BillingConflict);
});

test('a refund arriving before the purchase cannot be undone by replay, but a separate renewal remains valid',()=>{
  let ledger=applyVerifiedBillingFact(emptyBillingLedger(source),refund('refund-1','transaction-1'));
  ledger=applyVerifiedBillingFact(ledger,period('purchase-1','transaction-1',start,end));
  assert.equal(entitlementAt([ledger],'2026-10-15T00:00:00.000Z').state,'refunded');
  ledger=applyVerifiedBillingFact(ledger,period('renewal-2','transaction-2',end,later));
  assert.equal(entitlementAt([ledger],'2026-11-15T00:00:00.000Z').state,'active');
  ledger=applyVerifiedBillingFact(ledger,refund('refund-2','transaction-2'));
  assert.equal(entitlementAt([ledger],'2026-11-15T00:00:00.000Z').state,'refunded');
});

test('cancelled renewal does not cut short paid access, and late status updates cannot re-enable it',()=>{
  let ledger=applyVerifiedBillingFact(emptyBillingLedger(source),period('purchase-1','transaction-1',start,end));
  ledger=applyVerifiedBillingFact(ledger,{kind:'renewal',eventId:'cancel-2',source,revision:2,enabled:false});
  ledger=applyVerifiedBillingFact(ledger,{kind:'renewal',eventId:'old-renew-1',source,revision:1,enabled:true});
  assert.deepEqual(entitlementAt([ledger],'2026-10-15T00:00:00.000Z'),{state:'active',productId:'family-month',validUntil:end,autoRenew:false});
  assert.throws(()=>applyVerifiedBillingFact(ledger,{kind:'renewal',eventId:'conflict',source,revision:2,enabled:true}),BillingConflict);
});

test('grace ends at its verified boundary; stale grace updates and fully refunded subscriptions cannot extend it',()=>{
  let ledger=applyVerifiedBillingFact(emptyBillingLedger(source),period('purchase-1','transaction-1',start,end));
  ledger=applyVerifiedBillingFact(ledger,{kind:'grace',eventId:'grace-2',source,revision:2,productId:'family-month',until:'2026-11-08T00:00:00.000Z'});
  ledger=applyVerifiedBillingFact(ledger,{kind:'grace',eventId:'grace-1',source,revision:1,productId:'family-month',until:later});
  assert.equal(entitlementAt([ledger],'2026-11-03T00:00:00.000Z').state,'grace');
  assert.equal(entitlementAt([ledger],'2026-11-08T00:00:00.000Z').state,'expired');
  ledger=applyVerifiedBillingFact(ledger,refund('refund-1','transaction-1'));
  assert.equal(entitlementAt([ledger],'2026-11-03T00:00:00.000Z').state,'refunded');
});

test('sources stay separate and the family receives the longest current verified grant',()=>{
  const app=applyVerifiedBillingFact(emptyBillingLedger(source),period('app-1','app-transaction',start,end));
  const webSource={provider:'web' as const,originalTransactionId:'synthetic-web'};
  const web=applyVerifiedBillingFact(emptyBillingLedger(webSource),{...period('web-1','web-transaction',start,later),source:webSource});
  assert.equal(entitlementAt([app,web],'2026-10-15T00:00:00.000Z').validUntil,later);
  assert.throws(()=>applyVerifiedBillingFact(app,{...period('wrong','new',start,end),source:webSource}),BillingConflict);
  assert.equal(entitlementAt([],'2026-10-15T00:00:00.000Z').state,'free');
});

test('provider identifiers matching JavaScript object names remain ordinary transaction data',()=>{
  let ledger=applyVerifiedBillingFact(emptyBillingLedger(source),period('__proto__','toString',start,end));
  assert.equal(entitlementAt([ledger],'2026-10-15T00:00:00.000Z').state,'active');
  ledger=applyVerifiedBillingFact(ledger,refund('constructor','toString'));
  assert.equal(entitlementAt([ledger],'2026-10-15T00:00:00.000Z').state,'refunded');
  assert.equal(Object.getPrototypeOf(ledger.refunded),Object.prototype);
});
