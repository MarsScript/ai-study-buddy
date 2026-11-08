// Live subscription lifecycle: verified PayPal events, server-owned checkout intents,
// and completed transaction verification. Sandbox is completely separate.
import {json,config,verifyWebhook,safeSubscriptionId,eventSubscriptionId,subscriptionEvents,AppError,failure,LIMIT} from './_shared.js';
import {intentBySubscription,reconcileLiveSubscription} from './_checkout.js';

export async function onRequestPost({request,env}){
  try{
    config(env);
    if(Number(request.headers.get('content-length')||0)>LIMIT)throw new AppError('PAYLOAD_TOO_LARGE',413);
    const raw=await request.text();
    if(raw.length>LIMIT)throw new AppError('PAYLOAD_TOO_LARGE',413);
    let event;
    try{event=JSON.parse(raw)}catch{throw new AppError('INVALID_JSON',400)}
    await verifyWebhook(env,request,event);
    if(!subscriptionEvents.has(event.event_type))return json({received:true,ignored:'unhandled_event'});
    const id=eventSubscriptionId(event);
    if(!safeSubscriptionId(id))return json({received:true,ignored:'invalid_subscription_id'});
    const intent=await intentBySubscription(env,id);
    if(!intent)return json({received:true,ignored:'not_linked_to_student'});
    const result=await reconcileLiveSubscription(env,intent,{event_type:event.event_type});
    return json({received:true,premium:result.premium});
  }catch(e){return failure(e);}
}
