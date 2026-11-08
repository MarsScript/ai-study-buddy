// Simulated Sandbox status checks. No PayPal or Supabase network requests.
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/paypal/status.js';

const ID='11111111-1111-4111-8111-111111111111';
const STALE='I-STALE123456';
const ACTIVE='I-ACTIVE123456';
const PLAN='P-TEST123456';
const INTENT='22222222-2222-4222-8222-222222222222';
const makeIntent=id=>({id:INTENT,user_id:ID,paypal_subscription_id:id,paypal_plan_id:PLAN,status:'ACTIVE',created_at:'2026-10-28T00:00:00Z'});
const env={
  PAYPAL_CLIENT_ID:'sandbox-test-only',
  PAYPAL_CLIENT_SECRET:'sandbox-test-only',
  PAYPAL_PLAN_ID:PLAN,
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_ANON_KEY:'test-anon',
  SUPABASE_SERVICE_ROLE_KEY:'test-service-role'
};
function j(value,status=200){
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
}
async function runCase(name,ids,withError=false){
  const writes=[];
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(url);
    const path=parsed.pathname;
    const method=options.method||'GET';
    if(path==='/auth/v1/user')return j({id:ID});
    if(path==='/rest/v1/study_subscriptions'){
      if(method==='POST'){
        writes.push(JSON.parse(options.body));
        return j(writes);
      }
      return j([{user_id:ID,paypal_subscription_id:STALE,status:'ACTIVE'}]);
    }
    if(path==='/rest/v1/study_paypal_checkout_intents'){
      if(method==='PATCH')return j([]);
      return j(ids.map(makeIntent));
    }
    if(path==='/v1/oauth2/token')return j({access_token:'test-only-token'});
    if(path==='/v1/billing/subscriptions/'+STALE) return j({message:withError?'Unexpected PayPal server error':'The specified resource does not exist.'},withError?500:404);
    if(path==='/v1/billing/subscriptions/'+ACTIVE) return j({
      id:ACTIVE,plan_id:PLAN,custom_id:INTENT,status:'ACTIVE'
    });
    throw Error('Unexpected request to '+parsed.origin+path);
  };
  const request=new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal/status',{
    headers:{authorization:'Bearer test-user-token'}
  });
  const res=await onRequestGet({request,env});
  const body=await res.json();
  console.log(name,JSON.stringify({status:res.status,data:body,writes}));
  return {res,body,writes};
}
{
 const {res,body,writes}=await runCase('stale then active',[STALE,ACTIVE]);
 assert.equal(res.status,200);
 assert.equal(body.status,'ACTIVE');
 assert.equal(body.premium,true);
 assert.equal(body.subscription_id,ACTIVE);
 assert.equal(writes.length,1);
 assert.equal(writes[0].status,'ACTIVE');
}
{
 const {res,body,writes}=await runCase('only stale',[STALE]);
 assert.equal(res.status,200);
 assert.equal(body.status,'NOT_FOUND');
 assert.equal(body.code,'SANDBOX_SUBSCRIPTION_NOT_FOUND');
 assert.equal(body.premium,false);
 assert.equal(writes.length,1);
 assert.equal(writes[0].status,'UNVERIFIED');
}
{
 const {res,body,writes}=await runCase('unexpected PayPal 500',[STALE],true);
 assert.equal(res.status,502);
 assert.equal(body.code,'PAYPAL_500');
 assert.equal(writes.length,0);
}
console.log('PASS: Sandbox subscription 404 fails closed, other errors are not ignored.');
