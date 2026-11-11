// Live checkout creation is disabled by default. Only switch on AFTER full billing review.
import {json,paypal,failure,AppError,safeSubscriptionId} from './_shared.js';
import {authenticatedStudent,liveDb,knownForUser,intentsForUser,trialRedemptionForUser,saveIntent,assertPlan,isCheckoutEnabled,safePublicOrigin} from './_checkout.js';

export async function onRequestPost({request,env}){
  let intent=null;
  let paypalCreateAttempted=false;
  try{
    if(!isCheckoutEnabled(env))throw new AppError('LIVE_CHECKOUT_DISABLED',403);
    const userId=await authenticatedStudent(request,env);
    safePublicOrigin(request);
    await assertPlan(env); // Recheck that it is ACTIVE and still $3.99/month.
    const previous=await knownForUser(env,userId);
    if(previous?.status==='ACTIVE'&&Date.parse(previous.premium_expires_at)>Date.now()){
      throw new AppError('ALREADY_PREMIUM',409);
    }
    if(await trialRedemptionForUser(env,userId))throw new AppError('FREE_TRIAL_ALREADY_USED',409);
    const existing=await intentsForUser(env,userId);
    if(existing.some(x=>['CREATING','APPROVAL_PENDING','APPROVED','PAYMENT_PENDING','TRIAL_ACTIVE','ACTIVE'].includes(x.status))){
      throw new AppError('CHECKOUT_ALREADY_PENDING',409);
    }
    const inserted=await liveDb(env,'study_live_checkout_intents','POST','',{
      user_id:userId,paypal_plan_id:env.PAYPAL_LIVE_PLAN_ID,status:'CREATING'
    });
    intent=inserted[0];
    if(!intent?.id)throw new AppError('INTENT_NOT_SAVED',503);
    const origin=safePublicOrigin(request);
    // A failed PayPal create or failed DB write is intentionally NOT retried automatically.
    // Our unique pending-intent constraint prevents an accidental second recurring agreement.
    paypalCreateAttempted=true;
    const subscription=await paypal(env,'/v1/billing/subscriptions','POST',{
      plan_id:env.PAYPAL_LIVE_PLAN_ID,
      custom_id:intent.id,
      application_context:{
        brand_name:'AI Study Buddy',user_action:'SUBSCRIBE_NOW',
        shipping_preference:'NO_SHIPPING',
        return_url:origin+'/?paypal_live_return=1&checkout_id='+encodeURIComponent(intent.id),
        cancel_url:origin+'/?paypal_live_cancel=1&checkout_id='+encodeURIComponent(intent.id)
      }
    });
    const approval=subscription.links?.find(x=>x.rel==='approve')?.href;
    const parsed=approval?new URL(approval):null;
    if(!safeSubscriptionId(subscription.id)||!parsed||parsed.protocol!=='https:'||parsed.hostname!=='www.paypal.com'){
      throw new AppError('UNEXPECTED_PAYPAL_APPROVAL_URL',502);
    }
    const updated=await saveIntent(env,intent.id,{
      paypal_subscription_id:subscription.id,status:subscription.status||'APPROVAL_PENDING'
    });
    if(updated.length!==1)throw new AppError('INTENT_NOT_LINKED',503);
    return json({checkout_id:intent.id,subscription_id:subscription.id,url:approval});
  }catch(e){
    if(intent&&!paypalCreateAttempted){
      try{await saveIntent(env,intent.id,{status:'FAILED'});}catch{}
    }
    return failure(e);
  }
}
