// Safety checks for Live PayPal code. No external network or real payments.
import assert from 'node:assert/strict';
import {onRequestPost as create} from '../functions/api/paypal-live/create.js';
import {onRequestPost as confirm} from '../functions/api/paypal-live/confirm.js';
import {onRequestPost as cancel} from '../functions/api/paypal-live/cancel.js';
import {onRequestGet as status} from '../functions/api/paypal-live/status.js';
import {onRequestPost as webhook} from '../functions/api/paypal-live/webhook.js';
import {onRequestGet as health} from '../functions/api/paypal-live/health.js';

const ORIGIN='https://ai-study-buddy-9cz.pages.dev';
const env={
  PAYPAL_LIVE_CLIENT_ID:'fake_for_test_only',
  PAYPAL_LIVE_CLIENT_SECRET:'fake_for_test_only',
  PAYPAL_LIVE_PLAN_ID:'P-TESTONLY123456789',
  PAYPAL_LIVE_WEBHOOK_ID:'WH-TESTONLY',
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fake_for_test',
  SUPABASE_ANON_KEY:'sb_publishable_fake_for_test'
};
let calls=0;
globalThis.fetch=async()=>{calls+=1;throw new Error('Unexpected external request in safety test')};

const post=(path,body={})=>new Request(ORIGIN+path,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
});
const get=(path)=>new Request(ORIGIN+path);
const expect=async(label,fn,code,error)=>{
  const result=await fn();
  const data=await result.json();
  assert.equal(result.status,code,label+' HTTP status');
  if(error)assert.equal(data.error,error,label+' error code');
  console.log('PASS',label,result.status,error||'');
};

await expect('checkout disabled with absent switch',()=>create({request:post('/api/paypal-live/create'),env}),403,'LIVE_CHECKOUT_DISABLED');
await expect('checkout disabled with explicit false switch',()=>create({
  request:post('/api/paypal-live/create'),env:{...env,PAYPAL_LIVE_CHECKOUT_ENABLED:'false'}
}),403,'LIVE_CHECKOUT_DISABLED');
await expect('checkout still disabled when switch is true but launch audit is not approved',()=>create({
  request:post('/api/paypal-live/create'),env:{...env,PAYPAL_LIVE_CHECKOUT_ENABLED:'true'}
}),403,'LIVE_CHECKOUT_DISABLED');
await expect('checkout disabled before secret availability',()=>create({
  request:post('/api/paypal-live/create'),env:{}
}),403,'LIVE_CHECKOUT_DISABLED');
await expect('status requires authenticated student',()=>status({
  request:get('/api/paypal-live/status'),env
}),401,'SIGN_IN_REQUIRED');
await expect('confirm requires authenticated student',()=>confirm({
  request:post('/api/paypal-live/confirm'),env
}),401,'SIGN_IN_REQUIRED');
await expect('cancel requires authenticated student',()=>cancel({
  request:post('/api/paypal-live/cancel'),env
}),401,'SIGN_IN_REQUIRED');
await expect('unsigned webhook rejected',()=>webhook({
  request:post('/api/paypal-live/webhook',{event_type:'BILLING.SUBSCRIPTION.ACTIVATED',resource:{id:'I-1234567890'}}),env
}),401,'MISSING_PAYPAL_SIGNATURE');
const healthResult=await health({});
assert.equal(healthResult.status,200);
const healthData=await healthResult.json();
assert.equal(healthData.live_checkout_enabled,false);
console.log('PASS Stage 1 health remains live_checkout_enabled=false');
assert.equal(calls,0,'Disabled/untrusted requests must never access PayPal or Supabase');
console.log('All Live PayPal safe-mode smoke tests passed; zero external requests.');
