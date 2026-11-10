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
  if(!['study_live_checkout_intents','study_live_subscriptions','study_trial_redemptions'].includes(table))throw new AppError('BAD_TABLE',500);
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
    '?select=user_id,paypal_plan_id,paypal_subscription_id,status,verified_payment_id,premium_expires_at,trial_expires_at,updated_at&user_id='+eq(userId)+'&limit=1');
  return rows[0]||null;
}
export async function trialRedemptionForUser(env,userId){
  const rows=await liveDb(env,'study_trial_redemptions','GET',
    '?select=user_id,paypal_subscription_id&user_id='+eq(userId)+'&limit=1');
  return rows[0]||null;
}
async function redeemTrial(env,userId,subscriptionId){
  const existing=await trialRedemptionForUser(env,userId);
  if(existing){
    if(existing.paypal_subscription_id!==subscriptionId)throw new AppError('FREE_TRIAL_ALREADY_USED',409);
    return;
  }
  await liveDb(env,'study_trial_redemptions','POST','',{user_id:userId,paypal_subscription_id:subscriptionId});
}
export async function saveIntent(env,intentId,patch){
  return liveDb(env,'study_live_checkout_intents','PATCH','?id='+eq(intentId),{...patch,updated_at:new Date().toISOString()});
}
export async function saveEntitlement(env,identity,subscriptionId,status,paymentId,expiresAt,trialExpiresAt=null){
  if(!safeSubscriptionId(subscriptionId)||!uuid(identity))throw new AppError('INVALID_RECORD',500);
  return liveDb(env,'study_live_subscriptions','POST','?on_conflict=user_id',{
    user_id:identity,paypal_subscription_id:subscriptionId,paypal_plan_id:env.PAYPAL_LIVE_PLAN_ID,
    status,verified_payment_id:paymentId||null,premium_expires_at:expiresAt||null,trial_expires_at:trialExpiresAt||null,updated_at:new Date().toISOString()
  });
}
export function isThreeDayTrialPlan(plan){
  const billing=plan.billing_cycles||[];
  const trials=billing.filter(c=>c.tenure_type==='TRIAL');
  const regulars=billing.filter(c=>c.tenure_type==='REGULAR');
  const trial=trials[0],regular=regulars[0];
  return billing.length===2 && trials.length===1 && regulars.length===1 &&
    trial.sequence===1 && trial.total_cycles===1 &&
    trial.frequency?.interval_unit==='DAY' && Number(trial.frequency?.interval_count)===3 &&
    (!trial.pricing_scheme?.fixed_price || (
      Number(trial.pricing_scheme.fixed_price.value)===0 &&
      trial.pricing_scheme.fixed_price.currency_code==='USD')) &&
    regular.sequence===2 && regular.frequency?.interval_unit==='MONTH' &&
    Number(regular.frequency?.interval_count)===1 && Number(regular.total_cycles)===0 &&
    regular.pricing_scheme?.fixed_price?.currency_code==='USD' &&
    Number(regular.pricing_scheme.fixed_price.value)===Number(LIVE_PRICE) &&
    Number(plan.payment_preferences?.setup_fee?.value||0)===0;
}
export async function assertPlan(env){
  const plan=await paypal(env,'/v1/billing/plans/'+encodeURIComponent(env.PAYPAL_LIVE_PLAN_ID));
  const okay=plan.id===env.PAYPAL_LIVE_PLAN_ID && isThreeDayTrialPlan(plan);
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
// The start/end timestamps come from PayPal, not the browser.
export function approvedTrialExpiry(details,intent){
  if(details.status!=='ACTIVE')return null;
  const start=Date.parse(details.start_time);
  const next=Date.parse(details.billing_info?.next_billing_time);
  const intentCreated=Date.parse(intent.created_at);
  const now=Date.now();
  const threeDays=3*86400000;
  if(![start,next,intentCreated].every(Number.isFinite) ||
    start<intentCreated-10*60000 || start>now ||
    next<=now || next>start+threeDays+12*3600000 ||
    next<start+threeDays-12*3600000 ||
    now>=start+threeDays || Number(details.billing_info?.failed_payments_count||0)!==0){
    return null;
  }
  // A settled subscription payment means the free-trial period is already over.
  if(details.billing_info?.last_payment?.time)return null;
  return new Date(Math.min(start+threeDays,next)).toISOString();
}
export function safePublicOrigin(request){
  // Never derive the approved payment return URL from untrusted Host headers.
  const u=new URL(request.url);
  if(u.hostname!=='ai-study-buddy-9cz.pages.dev')throw new AppError('PRODUCTION_DOMAIN_REQUIRED',403);
  return ORIGIN;
}

export function paidPeriodEnd(details,payment){
  const paidAt=Date.parse(payment?.time);
  const nextAt=Date.parse(details.billing_info?.next_billing_time);
  if(!Number.isFinite(paidAt)||!Number.isFinite(nextAt)||nextAt<=Date.now()||nextAt>paidAt+40*86400000){
    return null;
  }
  // Premium cannot outlive the billing period even if future webhook delivery fails.
  return new Date(nextAt).toISOString();
}
export async function reconcileLiveSubscription(env,intent,opts={}){
  const subId=intent?.paypal_subscription_id;
  const details=await verifyOwnership(env,intent,subId);
  const previous=await knownForUser(env,intent.user_id);
  if(previous&&previous.paypal_subscription_id!==subId&&previous.status==='ACTIVE'&&Date.parse(previous.premium_expires_at)>Date.now()){
    throw new AppError('OTHER_ACTIVE_LIVE_SUBSCRIPTION',409);
  }
  let status=details.status||'UNKNOWN';
  const eventType=opts.event_type||'';
  if(eventType==='PAYMENT.SALE.REVERSED'||eventType==='PAYMENT.SALE.REFUNDED')status='REVIEW_REQUIRED';
  else if(eventType==='BILLING.SUBSCRIPTION.PAYMENT.FAILED')status='PAYMENT_FAILED';
  else if(['BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.SUSPENDED'].includes(eventType)){
    status=eventType.split('.').pop();
  }
  else if(details.status==='ACTIVE'){
    const cutoff=previous&&['PAYMENT_FAILED','REVIEW_REQUIRED'].includes(previous.status)?previous.updated_at:null;
    const transaction=await completedPayment(env,details,intent,cutoff);
    const until=transaction?paidPeriodEnd(details,transaction):null;
    if(transaction&&until&&Number(details.billing_info?.failed_payments_count||0)===0){
      status='ACTIVE';
      await saveEntitlement(env,intent.user_id,subId,'ACTIVE',transaction.id,until);
      await saveIntent(env,intent.id,{status:'ACTIVE'});
      return {status,premium:true,subscription_id:subId,premium_expires_at:until};
    }
    // Premium starts after PayPal authorizes the subscription, before any charge.
    const trialExpires=approvedTrialExpiry(details,intent);
    if(trialExpires){
      await redeemTrial(env,intent.user_id,subId); // One trial per account.
      await saveEntitlement(env,intent.user_id,subId,'TRIAL_ACTIVE',null,null,trialExpires);
      await saveIntent(env,intent.id,{status:'TRIAL_ACTIVE'});
      return {status:'TRIAL_ACTIVE',premium:false,trial_active:true,
        trial_expires_at:trialExpires,subscription_id:subId};
    }
    status='PAYMENT_PENDING';
  }
  // Do not allow a PayPal status alone to activate Premium before a completed transaction.
  await saveEntitlement(env,intent.user_id,subId,status,null,null);
  await saveIntent(env,intent.id,{status});
  return {status,premium:false,subscription_id:subId};
}
