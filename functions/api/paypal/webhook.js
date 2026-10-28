import {json,paypal,admin,validSubscriptionId,linkedSubscription} from './_shared.js';
const relevant=new Set(['BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.CREATED','BILLING.SUBSCRIPTION.RE-ACTIVATED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.UPDATED','BILLING.SUBSCRIPTION.PAYMENT.FAILED','PAYMENT.SALE.COMPLETED','PAYMENT.SALE.REVERSED','PAYMENT.SALE.REFUNDED']);
export async function onRequestPost({request,env}){
 try{
  if(!env.PAYPAL_WEBHOOK_ID)return json({error:'Webhook ID has not been configured'},503);
  const event=await request.json();const h=request.headers;
  const proof=await paypal('/v1/notifications/verify-webhook-signature',env,'POST',{
   auth_algo:h.get('paypal-auth-algo'),cert_url:h.get('paypal-cert-url'),transmission_id:h.get('paypal-transmission-id'),transmission_sig:h.get('paypal-transmission-sig'),transmission_time:h.get('paypal-transmission-time'),webhook_id:env.PAYPAL_WEBHOOK_ID,webhook_event:event
  });
  if(proof.verification_status!=='SUCCESS')return json({error:'Webhook signature invalid'},401);
  if(!relevant.has(event.event_type))return json({received:true});
  let id=event.resource?.id;
  if(event.event_type.startsWith('PAYMENT.'))id=event.resource?.billing_agreement_id||event.resource?.subscription_id;
  if(!validSubscriptionId(id))return json({received:true});
  // Trust only subscriptions recorded at authenticated checkout creation.
  const linked=await linkedSubscription(env,id);
  if(!linked)return json({received:true});
  const subscription=await paypal('/v1/billing/subscriptions/'+encodeURIComponent(id),env);
  if(subscription.id!==id||subscription.plan_id!==env.PAYPAL_PLAN_ID||subscription.custom_id&&subscription.custom_id!==linked.user_id)return json({received:true});
  await admin(env,'study_subscriptions','PATCH',{status:subscription.status||'UNKNOWN',updated_at:new Date().toISOString()},'?user_id=eq.'+encodeURIComponent(linked.user_id)+'&paypal_subscription_id=eq.'+encodeURIComponent(id));
  return json({received:true});
 }catch(e){return json({error:e.message},500)}
}
