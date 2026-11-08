// Simulated owner-only complimentary Premium grants — never touches real Supabase or PayPal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {onRequestPost as changeCourtesy} from '../functions/api/support/complimentary.js';
import {onRequestGet as liveStatus} from '../functions/api/paypal-live/status.js';
const OWNER='11111111-1111-4111-8111-111111111111';
const STUDENT='22222222-2222-4222-8222-222222222222';
const PLAN='P-TESTPLAN987654';
const env={
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'sb_secret_testonly',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_testonly',
  PAYPAL_LIVE_CLIENT_ID:'test_client',
  PAYPAL_LIVE_CLIENT_SECRET:'test_secret',
  PAYPAL_LIVE_PLAN_ID:PLAN,
  PAYPAL_LIVE_WEBHOOK_ID:'test_webhook'
};
const email='student@example.test';
const reason='A seven-day complimentary test for a student who requested support.';
let who=OWNER,role='owner',courtesy=null, rpcCalls=[],payPalRequests=0;
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});}
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname.includes('paypal.com')){payPalRequests++;throw Error('PayPal must not be called');}
  assert.equal(u.hostname,'example.supabase.co');
  const path=u.pathname,method=options.method||'GET';
  if(path==='/auth/v1/user')return json({id:who,email:who===OWNER?'owner@example.test':email});
  if(path==='/rest/v1/study_support_roles')return json(role==='none'?[]:[{role}]);
  if(path==='/rest/v1/rpc/study_owner_change_complimentary_premium'){
    assert.equal(method,'POST');
    const args=JSON.parse(options.body);
    rpcCalls.push(args);
    assert.equal(args.p_actor_user_id,OWNER);
    assert.equal(args.p_email,email);
    assert.equal(args.p_confirm_email,email);
    if(args.p_action==='grant'){
      courtesy={user_id:STUDENT,revoked_at:null,
        expires_at:new Date(Date.now()+args.p_days*86400000).toISOString()};
      return json([{customer_user_id:STUDENT,customer_email:email,complimentary_active:true,ends_at:courtesy.expires_at}]);
    }
    courtesy={...courtesy,revoked_at:new Date().toISOString()};
    return json([{customer_user_id:STUDENT,customer_email:email,complimentary_active:false,ends_at:null}]);
  }
  if(path==='/rest/v1/study_live_subscriptions')return json([]);
  if(path==='/rest/v1/study_live_checkout_intents')return json([]);
  if(path==='/rest/v1/study_complimentary_premium'){
    return json(who===STUDENT && courtesy?[courtesy]:[]);
  }
  throw Error('Unexpected request: '+u.toString());
};
function req(payload,auth=true){
  const headers={'content-type':'application/json'};
  if(auth)headers.authorization='Bearer mock-jwt';
  return new Request('https://ai-study-buddy-9cz.pages.dev/api/support/complimentary',{
    method:'POST',headers,body:JSON.stringify(payload)
  });
}
function args(action='grant',days=7,extras={}){
 return {action,email,confirm_email:email,days,reason,...extras};
}
async function check(label,request,status,code){
 const r=await changeCourtesy({request,env});
 assert.equal(r.status,status,label);
 const data=await r.json();
 if(code)assert.equal(data.error,code,label);
 console.log('PASS',label,status,code||'');
 return data;
}
await check('Unsigned caller denied',req(args(),false),401,'SIGN_IN_REQUIRED');
role='none';
await check('Ordinary student denied',req(args()),403,'SUPPORT_ACCESS_DENIED');
role='support';
await check('Read-only support staff denied',req(args()),403,'OWNER_ONLY');
role='owner';
await check('Wrong confirmation email denied',req(args('grant',7,{confirm_email:'other@example.test'})),400,'CONFIRM_CUSTOMER_EMAIL');
await check('Invalid grant duration denied',req(args('grant',365)),400,'INVALID_GRANT_DAYS');
await check('Missing audit reason denied',req(args('grant',7,{reason:'x'})),400,'REASON_REQUIRED');
assert.equal(rpcCalls.length,0,'Invalid requests cannot reach the grant RPC');
const granted=await check('Owner can grant 7 days',req(args()),200);
assert.equal(granted.complimentary_active,true);
assert.ok(Date.parse(granted.complimentary_expires_at)>Date.now());
assert.equal(rpcCalls.length,1);
who=STUDENT;
let response=await liveStatus({request:new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal-live/status',{headers:{authorization:'Bearer mock-student'}}),env});
assert.equal(response.status,200);
let status=await response.json();
assert.equal(status.premium,false,'Courtesy must not become paid PayPal Premium');
assert.equal(status.complimentary_premium,true);
assert.equal(status.complimentary_expires_at,granted.complimentary_expires_at);
console.log('PASS Student sees complimentary Premium, not paid status.');
who=OWNER;
const revoked=await check('Owner can revoke courtesy access',req(args('revoke',null)),200);
assert.equal(revoked.complimentary_active,false);
who=STUDENT;
response=await liveStatus({request:new Request('https://ai-study-buddy-9cz.pages.dev/api/paypal-live/status',{headers:{authorization:'Bearer mock-student'}}),env});
status=await response.json();
assert.equal(status.premium,false);
assert.equal(status.complimentary_premium,false);
console.log('PASS Revocation removes courtesy status.');
assert.equal(payPalRequests,0,'No real or simulated PayPal subscription requests were performed');
const sql=fs.readFileSync(new URL('../sql/06_complimentary_premium.sql',import.meta.url),'utf8');
for(const required of [
  'study_complimentary_premium',
  "role = 'owner'",
  "'COURTESY_GRANTED'",
  "'COURTESY_REVOKED'",
  'study_support_audit',
  'study_consume_ai_daily_quota',
  'c.revoked_at IS NULL AND c.expires_at > now()',
  's.verified_payment_id IS NOT NULL'
])assert.ok(sql.includes(required),'Missing SQL requirement: '+required);
console.log('All complimentary-Premium smoke tests passed; no live services contacted.');
