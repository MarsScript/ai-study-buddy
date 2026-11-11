// Authenticated, no-charge recovery for a PayPal Live webhook/redirect that was missed.
// Verifies the original server-owned checkout intent and a real completed payment.
// Does not create or modify PayPal subscriptions. Does not bypass plan, owner, or payment checks.
import {json,AppError,failure} from './_shared.js';
import {authenticatedStudent,intentsForUser,reconcileLiveSubscription} from './_checkout.js';

export async function onRequestPost({request,env}){
  try{
    const userId=await authenticatedStudent(request,env);
    const intents=await intentsForUser(env,userId);
    const valid=new Set(['APPROVAL_PENDING','APPROVED','PAYMENT_PENDING','TRIAL_ACTIVE','ACTIVE','PAYMENT_FAILED']);
    const candidate=intents.find(i=>i.paypal_subscription_id&&valid.has(i.status));
    if(!candidate){
      return json({premium:false,status:intents[0]?.status||'FREE',code:'NO_RECOVERABLE_LIVE_CHECKOUT'});
    }
    // A customer cannot supply another person's subscription ID in this request.
    const result=await reconcileLiveSubscription(env,candidate);
    return json({...result,verified_with_paypal:true});
  }catch(e){return failure(e);}
}
