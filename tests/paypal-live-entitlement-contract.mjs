// Contract tests: Live PayPal subscription -> authenticated Premium entitlement.
// All PayPal / Supabase requests are simulated. No network requests and NO payments.
import assert from 'node:assert/strict';
import {reconcileLiveSubscription} from '../functions/api/paypal-live/_checkout.js';
import {onRequestGet as liveStatus} from '../functions/api/paypal-live/status.js';
import {onRequestPost as recheckPayment} from '../functions/api/paypal-live/reconcile.js';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const INTENT='33333333-3333-4333-8333-333333333333';
const SUB='I-SUBSCRIPTION123';
const PLAN='P-TESTPLAN12345678';
const env={
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'sb_secret_dummy_for_mock',
  SUPABASE_ANON_KEY:'sb_publishable_mock',
  PAYPAL_LIVE_CLIENT_ID:'mock-client',
  PAYPAL_LIVE_CLIENT_SECRET:'mock-secret',
  PAYPAL_LIVE_PLAN_ID:PLAN,
  PAYPAL_LIVE_WEBHOOK_ID:'mock-webhook'
};
const intent={
  id:INTENT,user_id:A,paypal_plan_id:PLAN,paypal_subscription_id:SUB,
  status:'APPROVAL_PENDING',created_at:new Date(Date.now()-86400000).toISOString()
};
const response=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'}
});
const time=()=>new Date().toISOString();
const future=()=>new Date(Date.now()+25*86400000).toISOString();
let account=A;
let actualPlan=PLAN;
let subscriptionStatus='ACTIVE';
let transactions=[];
let dbRow=null;
let writes=[];
let intentChanges=[];
let callCounter=0;
let failureCount=0;
let billingTime=future();
const currentDetails=()=>({
  id:SUB,plan_id:actualPlan,custom_id:INTENT,status:subscriptionStatus,
  billing_info:{next_billing_time:billingTime,failed_payments_count:failureCount}
});
const paid=(amount='3.99',status='COMPLETED')=>({
  id:'PAY-'+String(Math.random()).slice(2),
  status,time:time(),
  amount_with_breakdown:{gross_amount:{currency_code:'USD',value:amount}}
});
globalThis.fetch=async(u,o={})=>{
  callCounter++;
  const url=new URL(u),method=o.method||'GET',path=url.pathname;
  if(url.hostname==='api-m.paypal.com'){
    if(path==='/v1/oauth2/token')return response({access_token:'NOT_REAL_TOKEN'});
    if(path.startsWith('/v1/billing/subscriptions/')&&path.endsWith('/transactions'))return response({transactions});
    if(path==='/v1/billing/subscriptions/'+SUB)return response(currentDetails());
    throw Error('Unexpected PayPal path: '+path);
  }
  if(url.hostname==='example.supabase.co'){
    if(path==='/auth/v1/user')return response({id:account});
    if(path==='/rest/v1/study_live_subscriptions'){
      if(method==='POST'){
        const next=JSON.parse(o.body);
        dbRow=next;writes.push(next);
        return response([next]);
      }
      return response(dbRow&&dbRow.user_id===new URLSearchParams(url.search).get('user_id')?.slice(3)?[dbRow]:[]);
    }
    if(path==='/rest/v1/study_complimentary_premium')return response([]);
    if(path==='/rest/v1/study_live_checkout_intents'){
      if(method==='PATCH'){
        intentChanges.push(JSON.parse(o.body));return response([intent]);
      }
      const who=new URLSearchParams(url.search).get('user_id');
      return response(who==='eq.'+account&&account===A?[intent]:[]);
    }
  }
  throw Error('Unexpected network request: '+url.href);
};
const statusFor=async(who)=>{
  account=who;
  const req=new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal-live/status',{
    headers:{authorization:'Bearer mock-'+who}
  });
  const res=await liveStatus({request:req,env});
  assert.equal(res.status,200);
  return res.json();
};
async function reset(){
  actualPlan=PLAN;subscriptionStatus='ACTIVE';transactions=[];
  dbRow=null;writes=[];intentChanges=[];failureCount=0;billingTime=future();
}
const run=async(title,fn)=>{await reset();await fn();console.log('PASS:',title)};
await run('PayPal says ACTIVE, but no payment: Premium denied',async()=>{
  const result=await reconcileLiveSubscription(env,intent);
  assert.equal(result.status,'PAYMENT_PENDING');
  assert.equal(result.premium,false);
  assert.equal(dbRow.verified_payment_id,null);
  assert.equal((await statusFor(A)).premium,false);
});
await run('Payment wrong price: Premium denied',async()=>{
  transactions=[paid('0.01')];
  assert.equal((await reconcileLiveSubscription(env,intent)).premium,false);
  assert.equal(dbRow.status,'PAYMENT_PENDING');
});
await run('Payment pending rather than completed: Premium denied',async()=>{
  transactions=[paid('3.99','PENDING')];
  assert.equal((await reconcileLiveSubscription(env,intent)).premium,false);
});
await run('Verified completed $3.99: Premium ACTIVE for owning student only',async()=>{
  transactions=[paid()];
  const result=await reconcileLiveSubscription(env,intent);
  assert.equal(result.premium,true);
  assert.equal(result.status,'ACTIVE');
  assert.equal(dbRow.user_id,A);
  assert.equal(dbRow.verified_payment_id,transactions[0].id);
  assert.ok(Date.parse(dbRow.premium_expires_at)>Date.now());
  const own=await statusFor(A),other=await statusFor(B);
  assert.equal(own.premium,true);
  assert.equal(other.premium,false);
});
await run('Wrong PayPal plan cannot activate Premium',async()=>{
  transactions=[paid()];actualPlan='P-SOMEOTHERPLAN';
  await assert.rejects(reconcileLiveSubscription(env,intent),e=>e.code==='LIVE_SUBSCRIPTION_MISMATCH');
  assert.equal(writes.length,0);
});
await run('Refund revokes previous verified Premium',async()=>{
  transactions=[paid()];
  await reconcileLiveSubscription(env,intent);
  assert.equal((await statusFor(A)).premium,true);
  const after=await reconcileLiveSubscription(env,intent,{event_type:'PAYMENT.SALE.REFUNDED'});
  assert.equal(after.premium,false);
  assert.equal(dbRow.status,'REVIEW_REQUIRED');
  assert.equal(dbRow.verified_payment_id,null);
  assert.equal((await statusFor(A)).premium,false);
});
await run('Failed renewal revokes Premium pending new payment',async()=>{
  transactions=[paid()];
  await reconcileLiveSubscription(env,intent);
  const after=await reconcileLiveSubscription(env,intent,{event_type:'BILLING.SUBSCRIPTION.PAYMENT.FAILED'});
  assert.equal(after.premium,false);
  assert.equal(dbRow.status,'PAYMENT_FAILED');
});
await run('Subscription cancellation revokes Premium',async()=>{
  transactions=[paid()];
  await reconcileLiveSubscription(env,intent);
  const after=await reconcileLiveSubscription(env,intent,{event_type:'BILLING.SUBSCRIPTION.CANCELLED'});
  assert.equal(after.premium,false);
  assert.equal(dbRow.status,'CANCELLED');
  assert.equal((await statusFor(A)).premium,false);
});
await run('Expired paid-through timestamp cannot show active access',async()=>{
  transactions=[paid()];
  await reconcileLiveSubscription(env,intent);
  dbRow.premium_expires_at=new Date(Date.now()-60000).toISOString();
  assert.equal((await statusFor(A)).premium,false);
});

await run('Signed-in student can recover verified payment after a missed webhook',async()=>{
  account=A;
  transactions=[paid()];
  const request=new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal-live/reconcile',{
    method:'POST',headers:{authorization:'Bearer mock-'+A}
  });
  const response=await recheckPayment({request,env});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.premium,true);
  assert.equal(result.verified_with_paypal,true);
  assert.equal((await statusFor(A)).premium,true);
});
await run('No completed payment cannot be self-activated by pressing recheck',async()=>{
  account=A;
  const request=new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal-live/reconcile',{
    method:'POST',headers:{authorization:'Bearer mock-'+A}
  });
  const response=await recheckPayment({request,env});
  const result=await response.json();
  assert.equal(result.premium,false);
  assert.equal(result.status,'PAYMENT_PENDING');
  assert.equal((await statusFor(A)).premium,false);
});
await run('A different signed-in student cannot recover another account payment',async()=>{
  account=B;
  transactions=[paid()];
  const request=new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal-live/reconcile',{
    method:'POST',headers:{authorization:'Bearer mock-'+B}
  });
  const response=await recheckPayment({request,env});
  const result=await response.json();
  assert.equal(result.premium,false);
  assert.equal(result.code,'NO_RECOVERABLE_LIVE_CHECKOUT');
  assert.equal(writes.length,0);
});
assert.ok(callCounter>0);
console.log('ALL SIMULATED LIVE ENTITLEMENT TESTS PASSED — No real PayPal or Supabase requests made.');
