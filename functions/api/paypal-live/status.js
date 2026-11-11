// Read-only Live subscription status for authenticated students.
// The server-side AI quota remains the sole authority for Premium access.
import {json,failure} from './_shared.js';
import {authenticatedStudent,knownForUser,intentsForUser,isCheckoutEnabled} from './_checkout.js';
import {query as supportQuery} from '../support/_shared.js';
export async function onRequestGet({request,env}){
  try{
    const userId=await authenticatedStudent(request,env);
    const current=await knownForUser(env,userId);
    const intents=await intentsForUser(env,userId);
    // Courtesy Premium is a separate, time-limited entitlement: never present it as a paid PayPal subscription.
    const courtesyRows=await supportQuery(env,
      'study_complimentary_premium?select=expires_at,revoked_at&user_id=eq.'+encodeURIComponent(userId)+'&limit=1');
    const courtesy=courtesyRows[0]||null;
    const courtesyActive=!!(courtesy && !courtesy.revoked_at && Date.parse(courtesy.expires_at)>Date.now());
    const trialActive=current?.status==='TRIAL_ACTIVE' &&
      current.paypal_plan_id===env.PAYPAL_LIVE_PLAN_ID &&
      Date.parse(current.trial_expires_at)>Date.now();
    const active= current?.status==='ACTIVE' &&
      current.paypal_plan_id===env.PAYPAL_LIVE_PLAN_ID &&
      !!current.verified_payment_id &&
      Date.parse(current.premium_expires_at)>Date.now();
    return json({
      premium:!!active,
      trial_active:!!trialActive,
      trial_expires_at:trialActive?current.trial_expires_at:null,
      complimentary_premium:courtesyActive,
      complimentary_expires_at:courtesyActive?courtesy.expires_at:null,
      status:current?.status||intents[0]?.status||'FREE',
      premium_expires_at:active?current.premium_expires_at:null,
      checkout_in_progress:intents.some(i=>['CREATING','APPROVAL_PENDING','APPROVED','PAYMENT_PENDING'].includes(i.status)),
      live_checkout_enabled:isCheckoutEnabled(env)
    });
  }catch(e){return failure(e);}
}
