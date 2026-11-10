// User-requested PayPal Live cancellation. This endpoint remains available even if
// new checkout is disabled; users must be able to stop recurring payments.
import {json,paypal,AppError,failure} from './_shared.js';
import {authenticatedStudent,knownForUser,intentsForUser,verifyOwnership,saveEntitlement,saveIntent} from './_checkout.js';

export async function onRequestPost({request,env}){
  try{
    const userId=await authenticatedStudent(request,env);
    const record=await knownForUser(env,userId);
    const intents=await intentsForUser(env,userId);
    // Cancellation must also work just after approval, before the first payment is confirmed.
    const subscriptionId=intents.find(x=>x.paypal_subscription_id &&
      ['APPROVAL_PENDING','APPROVED','PAYMENT_PENDING','TRIAL_ACTIVE','ACTIVE'].includes(x.status))?.paypal_subscription_id ||
      record?.paypal_subscription_id;
    if(!subscriptionId)throw new AppError('NO_LIVE_SUBSCRIPTION',404);
    const intent=intents.find(x=>x.paypal_subscription_id===subscriptionId);
    if(!intent)throw new AppError('MISSING_OWNER_INTENT',403);
    const details=await verifyOwnership(env,intent,subscriptionId);
    if(!['CANCELLED','EXPIRED'].includes(details.status)){
      await paypal(env,'/v1/billing/subscriptions/'+encodeURIComponent(details.id)+'/cancel','POST',{
        reason:'Customer requested cancellation from AI Study Buddy'
      });
    }
    // Cancellation stops renewal; fail closed on Premium immediately pending reconciliation.
    await saveEntitlement(env,userId,subscriptionId,'CANCELLED',null,null);
    await saveIntent(env,intent.id,{status:'CANCELLED'});
    return json({cancelled:true,status:'CANCELLED'});
  }catch(e){return failure(e);}
}
