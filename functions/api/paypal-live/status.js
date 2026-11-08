// Read-only Live subscription status for authenticated students.
// The server-side AI quota remains the sole authority for Premium access.
import {json,failure} from './_shared.js';
import {authenticatedStudent,knownForUser,intentsForUser} from './_checkout.js';
export async function onRequestGet({request,env}){
  try{
    const userId=await authenticatedStudent(request,env);
    const current=await knownForUser(env,userId);
    const intents=await intentsForUser(env,userId);
    const active= current?.status==='ACTIVE' &&
      current.paypal_plan_id===env.PAYPAL_LIVE_PLAN_ID &&
      !!current.verified_payment_id &&
      Date.parse(current.premium_expires_at)>Date.now();
    return json({
      premium:!!active,
      status:current?.status||intents[0]?.status||'FREE',
      premium_expires_at:active?current.premium_expires_at:null,
      checkout_in_progress:intents.some(i=>['CREATING','APPROVAL_PENDING','APPROVED','PAYMENT_PENDING'].includes(i.status)),
      live_checkout_enabled:false
    });
  }catch(e){return failure(e);}
}
