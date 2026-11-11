// Regression: an old, inaccessible Sandbox subscription must not block a new test.
// All responses are mocked. No external requests and no real payments.
import assert from 'node:assert/strict';
import {onRequestPost as create} from '../functions/api/paypal/create.js';

const USER='11111111-1111-4111-8111-111111111111';
const OLD_INTENT='22222222-2222-4222-8222-222222222222';
const NEW_INTENT='33333333-3333-4333-8333-333333333333';
const STALE='I-STALE123456';
const FRESH='I-FRESH123456';
const PLAN='P-TESTPLAN123456';
const env={
  PAYPAL_CLIENT_ID:'sandbox-test-only',PAYPAL_CLIENT_SECRET:'sandbox-test-only',
  PAYPAL_PLAN_ID:PLAN,SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service'
};
const j=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const request=new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal/create',{
  method:'POST',headers:{authorization:'Bearer fake-test-token'}
});
async function test(name,oldResponseStatus,expectation){
  const writes=[],paypalCreates=[];
  globalThis.fetch=async(url,options={})=>{
    const u=new URL(url),method=options.method||'GET',path=u.pathname;
    if(path==='/auth/v1/user')return j({id:USER});
    if(path==='/rest/v1/study_subscriptions')return j([{user_id:USER,paypal_subscription_id:STALE,status:'UNVERIFIED'}]);
    if(path==='/rest/v1/study_paypal_checkout_intents'){
      if(method==='GET')return j([{id:OLD_INTENT,user_id:USER,paypal_subscription_id:STALE,paypal_plan_id:PLAN,status:'ACTIVE'}]);
      if(method==='POST'){const body=JSON.parse(options.body);writes.push(body);return j([{...body,id:NEW_INTENT}]);}
      if(method==='PATCH')return j([{id:NEW_INTENT,...JSON.parse(options.body)}]);
    }
    if(path==='/v1/oauth2/token')return j({access_token:'fake-sandbox-token'});
    if(path==='/v1/billing/subscriptions/'+STALE){
      if(oldResponseStatus===200)return j({id:STALE,plan_id:PLAN,custom_id:OLD_INTENT,status:'ACTIVE'});
      return j({message:'The specified resource does not exist.'},oldResponseStatus);
    }
    if(path==='/v1/billing/subscriptions'&&method==='POST'){
      paypalCreates.push(JSON.parse(options.body));
      return j({id:FRESH,status:'APPROVAL_PENDING',
        links:[{rel:'approve',href:'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=FAKE'}]});
    }
    throw Error('Unexpected request in mock: '+u.href);
  };
  const res=await create({request,env});
  const body=await res.json();
  if(expectation==='new'){
    assert.equal(res.status,200,name);assert.equal(body.checkout_id,NEW_INTENT);
    assert.equal(body.subscription_id,FRESH);assert.equal(paypalCreates.length,1);
    assert.equal(paypalCreates[0].plan_id,PLAN);assert.equal(writes.length,1);
    assert.equal(writes[0].user_id,USER);
  }else if(expectation==='stop'){
    assert.equal(res.status,502,name);assert.equal(body.code,'PAYPAL_'+oldResponseStatus);
    assert.equal(paypalCreates.length,0);assert.equal(writes.length,0);
  }else{
    assert.equal(res.status,200,name);assert.equal(body.already_active,true);
    assert.equal(paypalCreates.length,0);assert.equal(writes.length,0);
  }
  console.log('PASS',name);
}
await test('Stale 404 allows a new Sandbox checkout',404,'new');
await test('Unexpected PayPal 500 stops checkout',500,'stop');
await test('Existing verifiable ACTIVE subscription blocks duplicate',200,'active');
console.log('ALL Sandbox fresh-checkout tests passed — no PayPal payments or network.');
