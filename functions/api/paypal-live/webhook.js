// Secure Live webhook endpoint. No checkout endpoint is shipped in Stage 1.
import {json,config,verifyWebhook,paypal,getKnownSubscription,updateKnownSubscription,safeSubscriptionId,eventSubscriptionId,subscriptionEvents,AppError,failure,LIMIT} from './_shared.js';
export async function onRequestPost({request,env}){
  try{
    config(env);
    if(Number(request.headers.get('content-length')||0)>LIMIT)throw new AppError('PAYLOAD_TOO_LARGE',413);
    const raw=await request.text();
    if(raw.length>LIMIT)throw new AppError('PAYLOAD_TOO_LARGE',413);
    let event;
    try{event=JSON.parse(raw);}catch{throw new AppError('INVALID_JSON',400);}
    await verifyWebhook(env,request,event);
    if(!subscriptionEvents.has(event.event_type))return json({received:true,ignored:'unhandled_event'});
    const id=eventSubscriptionId(event);
    if(!safeSubscriptionId(id))return json({received:true,ignored:'no_valid_subscription_id'});
    const known=await getKnownSubscription(env,id);
    // CRITICAL: Never automatically link a subscription to a student based on webhook content.
    // A future authenticated Live checkout must first establish an ownership record.
    if(!known)return json({received:true,ignored:'not_linked_to_student'});
    if(known.paypal_plan_id!==env.PAYPAL_LIVE_PLAN_ID)return json({received:true,ignored:'different_plan'});
    const details=await paypal(env,'/v1/billing/subscriptions/'+encodeURIComponent(id));
    if(details.id!==id||details.plan_id!==env.PAYPAL_LIVE_PLAN_ID)throw new AppError('LIVE_PLAN_MISMATCH',409);
    const eventType=event.event_type;
    // Refunds or reversals can leave a subscription API status ACTIVE. Fail closed until reviewed.
    const status=eventType==='PAYMENT.SALE.REFUNDED'||eventType==='PAYMENT.SALE.REVERSED'?'REVIEW_REQUIRED':(details.status||'UNKNOWN');
    await updateKnownSubscription(env,id,status);
    return json({received:true});
  }catch(e){return failure(e);}
}
