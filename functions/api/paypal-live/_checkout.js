// Shared Live checkout helpers. Never imported by Sandbox routes.
import {config,paypal,AppError,safeSubscriptionId} from './_shared.js';

const ORIGIN = 'https://ai-study-buddy-9cz.pages.dev';
export const LIVE_PRICE = '3.99';
const uuid = x => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x||''));
const eq = x => 'eq.'+encodeURIComponent(x);
export const isCheckoutEnabled = env => env.PAYPAL_LIVE_CHECKOUT_ENABLED==='true';

export async function authenticatedStudent(request,env){
  config(env);
  const key=env.SUPABASE_ANON_KEY||env.SUPABASE_PUBLISHABLE_KEY;
  if(!key)throw new AppError('PUBLIC_SUPABASE_KEY_MISSING',503);
  const token=request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if(!token)throw new AppError('SIGN_IN_REQUIRED',401);
  const res=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:key,authorization:'Bearer '+token}});
  if(!res.ok)throw new AppError('LOGIN_EXPIRED',401);
  const person=await res.json();
  if(!uuid(person?.id))throw new AppError('INVALID_STUDENT',401);
  return person.id;
}

export async function liveDb(env,table,method='GET',query='',body){
  if(!['study_live_checkout_intents','study_live_subscriptions'].includes(table))throw new AppError('BAD_TABLE',500);
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  const headers={apikey:key,'content-type':'application/json',prefer:'return=representation,resolution=merge-duplicates'};
  if(!key.startsWith('sb_secret_'))headers.authorization='Bearer '+key;
  const res=await fetch(env.SUPABASE_URL+'/rest/v1/'+table+query,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
  if(!res.ok){
    console.error('[paypal-live] database operation failed',res.status,table);
    // Never leak Supabase keys, auth tokens, or raw DB error messages.
    if(res.status===409)throw new AppError('CHECKOUT_ALREADY_PENDING',409);
    throw new AppError('LIVE_DATABASE_UNAVAILABLE',503);
  }
  return res.status===204?[]:res.json().catch(()=>[]);
}
export async function intentsForUser(env,userId){
  return liveDb(env,'study_live_checkout_intents','GET',
    '?select=id,user_id,paypal_plan_id,paypal_subscription_id,status,created_at,updated_at&user_id='+eq(userId)+'&order=created_at.desc&limit=5');
}
export async function intentBySubscription(env,id){
  if(!safeSubscriptionId(id))return null;
  const rows=await liveDb(env,'study_live_checkout_intents','GET',
    '?select=id,user_id,paypal_plan_id,paypal_subscription_id,status,created_at,updated_at&paypal_subscription_id='+eq(id)+'&limit=1');
  return rows[0]||null;
}
export async function knownForUser(env,userId){
  const rows=await liveDb(env,'study_live_subscriptions','GET',
    '?select=user_id,paypal_plan_id,paypal_subscription_id,status,verified_payment_id,updated_at&user_id='+eq(userId)+'&limit=1');
  return rows[0]||null;
}
export async function saveIntent(env,intentId,patch){
  return liveDb(env,'study_live_checkout_intents','PATCH','?id='+eq(intentId),{...patch,updated_at:new Date().toISOString()});
}
export async function saveEntitlement(env,identity,subscriptionId,status,paymentId){
  if(!safeSubscriptionId(subscriptionId)||!uuid(identity))throw new AppError('INVALID_RECORD',500);
  return liveDb(env,'study_live_subscriptions','POST','?on_conflict=user_id',{
    user_id:identity,paypal_subscription_id:subscriptionId,paypal_plan_id:env.PAYPAL_LIVE_PLAN_ID,
    status,verified_payment_id:paymentId||null,updated_at:new Date().toISOString()
  });
}
export async function assertPlan(env){
  const plan=await paypal(env,'/v1/billing/plans/'+encodeURIComponent(env.PAYPAL_LIVE_PLAN_ID));
  const regular=(plan.billing_cycles||[]).filter(c=>c.tenure_type==='REGULAR');
  const cycle=regular[0];
  const fixed=cycle?.pricing_scheme?.fixed_price;
  const okay=plan.id===env.PAYPAL_LIVE_PLAN_ID && regular.length===1 &&
    cycle.frequency?.interval_unit==='MONTH' &&
    Number(cycle.frequency?.interval_count)===1 &&
    Number(cycle.total_cycles)===0 &&
    fixed?.currency_code==='USD'&&Number(fixed.value)===Number(LIVE_PRICE);
  if(!okay)throw new AppError('LIVE_PLAN_PRICE_MISMATCH',409);
  if(plan.status!=='ACTIVE')throw new AppError('LIVE_PLAN_NOT_ACTIVE',409);
}
export async function verifyOwnership(env,intent,subscriptionId){
  if(!intent||!safeSubscriptionId(subscriptionId)||intent.paypal_plan_id!==env.PAYPAL_LIVE_PLAN_ID||intent.paypal_subscription_id!==subscriptionId){
    throw new AppError('LIVE_SUBSCRIPTION_NOT_LINKED',403);
  }
  const details=await paypal(env,'/v1/billing/subscriptions/'+encodeURIComponent(subscriptionId));
  if(details.id!==subscriptionId||details.plan_id!==env.PAYPAL_LIVE_PLAN_ID||details.custom_id!==intent.id){
    throw new AppError('LIVE_SUBSCRIPTION_MISMATCH',403);
  }
  if(details.plan_overridden===true)throw new AppError('LIVE_PLAN_OVERRIDDEN',409);
  return details;
}
// Premium requires a real, recent settled PayPal transaction. ACTIVE alone is insufficient.
// Also used to verify recovery after payment failures; old payments must not restore access.
export async function completedPayment(env,details,intent,cutoff){
  if(details.status!=='ACTIVE')return null;
  const now=Date.now();
  const created=Date.parse(intent.created_at);
  const lower=Math.max(Number.isFinite(created)?created:now, now-35*24*60*60*1000);
  const rangeFrom=new Date(lower-60000).toISOString();
  const url='/v1/billing/subscriptions/'+encodeURIComponent(details.id)+
    '/transactions?start_time='+encodeURIComponent(rangeFrom)+'&end_time='+encodeURIComponent(new Date(now).toISOString());
  const result=await paypal(env,url);
  const paid=(result.transactions||[]).filter(t=>{
    const gross=t.amount_with_breakdown?.gross_amount;
    const timestamp=Date.parse(t.time);
    return t.status==='COMPLETED' && gross?.currency_code==='USD' &&
      Number(gross?.value)===Number(LIVE_PRICE) &&
      Number.isFinite(timestamp) && timestamp>=lower-60000 &&
      (!cutoff||timestamp>Date.parse(cutoff));
  });
  paid.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));
  return paid[0]||null;
}
export function safePublicOrigin(request){
  // Never derive the approved payment return URL from untrusted Host headers.
  const u=new URL(request.url);
  if(u.hostname!=='ai-study-buddy-9cz.pages.dev')throw new AppError('PRODUCTION_DOMAIN_REQUIRED',403);
  return ORIGIN;
}
