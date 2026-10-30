// AI Study Buddy Live PayPal – Stage 1: webhook verification and health ONLY.
// This folder deliberately has NO Live checkout endpoint. Never replace Sandbox files.
export const VERSION = 'paypal-live-stage1-2026-10-30';
const API = 'https://api-m.paypal.com';
const LIMIT = 250_000;
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
export const json = (data, status=200) => new Response(JSON.stringify({ ...data, version:VERSION }), {status, headers});
export class AppError extends Error { constructor(code, status=400){super(code);this.code=code;this.status=status;} }
export const failure = error => {
  if (error instanceof AppError) return json({error:error.code}, error.status);
  console.error('[paypal-live-stage1] Internal webhook error');
  return json({error:'SERVER_ERROR'},500);
};
export function config(env) {
  const names = ['PAYPAL_LIVE_CLIENT_ID','PAYPAL_LIVE_CLIENT_SECRET','PAYPAL_LIVE_PLAN_ID','PAYPAL_LIVE_WEBHOOK_ID','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
  const missing=names.filter(k=>!env[k]);
  if(missing.length)throw new AppError('CONFIG_MISSING',503);
  if(!/^P-[A-Za-z0-9]+$/.test(env.PAYPAL_LIVE_PLAN_ID))throw new AppError('INVALID_PLAN_ID',503);
  if(!new URL(env.SUPABASE_URL).hostname.endsWith('.supabase.co'))throw new AppError('INVALID_DATABASE_URL',503);
}
async function accessToken(env){
  const res=await fetch(API+'/v1/oauth2/token',{method:'POST',headers:{authorization:'Basic '+btoa(env.PAYPAL_LIVE_CLIENT_ID+':'+env.PAYPAL_LIVE_CLIENT_SECRET),'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
  if(!res.ok)throw new AppError('PAYPAL_LIVE_AUTH_ERROR',502);
  const data=await res.json();
  if(!data.access_token)throw new AppError('PAYPAL_LIVE_TOKEN_MISSING',502);
  return data.access_token;
}
export async function paypal(env, path, method='GET', body){
  const token=await accessToken(env);
  const res=await fetch(API+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json','accept':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new AppError('PAYPAL_LIVE_API_'+res.status,502);
  return data;
}
export async function verifyWebhook(env, request, event){
  const h=request.headers;
  const field = key => {
    const value=h.get('paypal-'+key);
    if(!value)throw new AppError('MISSING_PAYPAL_SIGNATURE',401);
    return value;
  };
  const result=await paypal(env,'/v1/notifications/verify-webhook-signature','POST',{
    auth_algo:field('auth-algo'),cert_url:field('cert-url'),transmission_id:field('transmission-id'),transmission_sig:field('transmission-sig'),transmission_time:field('transmission-time'),webhook_id:env.PAYPAL_LIVE_WEBHOOK_ID,webhook_event:event
  });
  if(result.verification_status!=='SUCCESS')throw new AppError('INVALID_PAYPAL_SIGNATURE',401);
}
const queryEq=value=>'eq.'+encodeURIComponent(value);
async function supabase(env, method, query, body){
  const res=await fetch(env.SUPABASE_URL+'/rest/v1/study_live_subscriptions'+query,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!res.ok)throw new AppError('SUPABASE_LIVE_'+res.status,502);
  return res.status===204?[]:res.json().catch(()=>[]);
}
export async function getKnownSubscription(env, id){
  const rows=await supabase(env,'GET','?select=user_id,paypal_subscription_id,paypal_plan_id,status&paypal_subscription_id='+queryEq(id)+'&limit=1');
  return rows[0]||null;
}
export async function updateKnownSubscription(env, id, status){
  await supabase(env,'PATCH','?paypal_subscription_id='+queryEq(id),{status,updated_at:new Date().toISOString()});
}
export function safeSubscriptionId(id){return /^I-[A-Za-z0-9]{6,64}$/.test(String(id||''));}
export const subscriptionEvents=new Set(['BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.CREATED','BILLING.SUBSCRIPTION.RE-ACTIVATED','BILLING.SUBSCRIPTION.UPDATED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.PAYMENT.FAILED','PAYMENT.SALE.COMPLETED','PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED']);
export function eventSubscriptionId(event){return event.event_type?.startsWith('PAYMENT.SALE.')?(event.resource?.billing_agreement_id||event.resource?.subscription_id):event.resource?.id;}
export {LIMIT};
