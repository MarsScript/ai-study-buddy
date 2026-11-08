// Simulated Support Admin authorization / privacy checks — zero external requests.
import assert from 'node:assert/strict';
import {onRequestGet as supportMe} from '../functions/api/support/me.js';
import {onRequestPost as supportLookup} from '../functions/api/support/lookup.js';

const USER='11111111-1111-4111-8111-111111111111';
const CUSTOMER='22222222-2222-4222-8222-222222222222';
const env={
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'sb_secret_testonly',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_testonly',
  PAYPAL_LIVE_PLAN_ID:'P-TEST12345'
};
let isAdmin=true;
let rowsReturned=true;
let auditAllowed=true;
let auditWrites=[];
let adminReads=0;
let sensitiveReads=0;
const reply=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'}
});
globalThis.fetch=async(url,options={})=>{
  const parsed=new URL(url),path=parsed.pathname;
  assert.equal(parsed.hostname,'example.supabase.co');
  const method=options.method||'GET';
  if(path==='/auth/v1/user')return reply({id:USER,email:'admin@example.test'});
  if(path==='/rest/v1/study_support_roles'){
    adminReads++;
    return reply(isAdmin?[{role:'owner'}]:[]);
  }
  if(path==='/rest/v1/rpc/study_support_find_customer') {
    assert.equal(method,'POST');
    return reply(rowsReturned?[{user_id:CUSTOMER,email:'student@example.test',registered_at:'2026-11-08T00:00:00Z'}]:[]);
  }
  if(path==='/rest/v1/study_support_audit'){
    assert.equal(method,'POST');
    if(!auditAllowed)return reply({message:'audit unavailable'},503);
    const entry=JSON.parse(options.body);
    assert.equal(entry.actor_user_id,USER);
    assert.equal(entry.action,'CUSTOMER_LOOKUP');
    auditWrites.push(entry);
    return reply([entry]);
  }
  if(path==='/rest/v1/study_live_subscriptions'){
    sensitiveReads++;
    return reply([{status:'ACTIVE',paypal_plan_id:'P-TEST12345',
      verified_payment_id:'PAYMENT-1',premium_expires_at:'2030-01-01T00:00:00Z',
      updated_at:'2026-11-08T00:00:00Z'}]);
  }
  if(path==='/rest/v1/study_live_checkout_intents'){
    sensitiveReads++;
    return reply([{status:'ACTIVE'}]);
  }
  if(path==='/rest/v1/study_ai_daily_usage'){
    sensitiveReads++;
    return reply([{used:4}]);
  }
  if(path==='/rest/v1/study_complimentary_premium'){
    sensitiveReads++;
    return reply([]);
  }
  throw Error('Unexpected data access '+path);
};
const auth={'authorization':'Bearer test-only-token'};
const post=(body,headers=auth)=>new Request('https://ai-study-buddy-9cz.pages.dev/api/support/lookup',{
  method:'POST',headers:{'content-type':'application/json',...headers},
  body:JSON.stringify(body)
});
let resp=await supportMe({request:new Request('https://ai-study-buddy-9cz.pages.dev/api/support/me'),env});
assert.equal(resp.status,401);
assert.equal(adminReads,0);
console.log('PASS: unsigned request cannot discover staff roles.');
isAdmin=false;
resp=await supportMe({request:new Request('https://ai-study-buddy-9cz.pages.dev/api/support/me',{headers:auth}),env});
assert.equal(resp.status,403);
console.log('PASS: normal student denied support dashboard.');
resp=await supportLookup({request:post({email:'student@example.test',reason:'Customer asked for billing help.'}),env});
assert.equal(resp.status,403);
assert.equal(sensitiveReads,0);
assert.equal(auditWrites.length,0);
console.log('PASS: normal student cannot access customer billing information.');
isAdmin=true;
resp=await supportLookup({request:post({email:'student@example.test',reason:'Customer asked for billing help.'}),env});
assert.equal(resp.status,200);
let result=await resp.json();
assert.equal(result.found,true);
assert.equal(result.live.premium,true);
assert.equal(result.ai_generations_today,4);
assert.equal(auditWrites.length,1);
assert.equal(auditWrites[0].target_user_id,CUSTOMER);
assert.equal('password' in result,false);
assert.equal('notes' in result,false);
console.log('PASS: privileged customer lookup returns minimum billing details and writes audit.');
rowsReturned=false;
resp=await supportLookup({request:post({email:'missing@example.test',reason:'Customer asked whether account exists.'}),env});
assert.equal(resp.status,200);
result=await resp.json();
assert.deepEqual(result,{found:false});
assert.equal(auditWrites.length,2);
console.log('PASS: unknown email lookup is also audited.');
auditAllowed=false;
resp=await supportLookup({request:post({email:'missing@example.test',reason:'Need to investigate support request.'}),env});
assert.equal(resp.status,503);
console.log('PASS: audit failure denies customer lookup.');
console.log('All Support Admin authorization tests passed; no real services contacted.');
