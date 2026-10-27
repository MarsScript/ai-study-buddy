import {json,paypal,admin} from './_shared.js';
const relevant=new Set(['BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.UPDATED','BILLING.SUBSCRIPTION.PAYMENT.FAILED','PAYMENT.SALE.COMPLETED','PAYMENT.SALE.REVERSED','PAYMENT.SALE.REFUNDED']);
export async function onRequestPost({request,env}){try{if(!env.PAYPAL_WEBHOOK_ID)return json({error:'Webhook ID has not been configured'},503);const event=await request.json();const h=request.headers;
 const proof=await paypal('/v1/notifications/verify-webhook-signature',env,'POST',{
 auth_algo:h.get('paypal-auth-algo'),cert_url:h.get('paypal-cert-url'),transmission_id:h.get('paypal-transmission-id'),transmission_sig:h.get('paypal-transmission-sig'),transmission_time:h.get('paypal-transmission-time'),webhook_id:env.PAYPAL_WEBHOOK_ID,webhook_event:event});
 if(proof.verification_status!=='SUCCESS')return json({error:'Webhook signature invalid'},401);
 if(!relevant.has(event.event_type))return json({received:true});
 let id=event.resource?.id;
 if(event.event_type.startsWith('PAYMENT.'))id=event.resource?.billing_agreement_id||event.resource?.subscription_id;
 if(!id)return json({received:true});
 if(!/^I-[A-Za-z0-9]+$/.test(id))return json({received:true});
 const subscription=await paypal('/v1/billing/subscriptions/'+encodeURIComponent(id),env);
 if(subscription.plan_id!==env.PAYPAL_PLAN_ID)return json({received:true});
 const uid=subscription.custom_id;if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(uid||''))return json({received:true});
 const matches=await admin(env,'study_subscriptions','GET',undefined,'?select=user_id,paypal_subscription_id&user_id=eq.'+encodeURIComponent(uid)+'&limit=1');
 if(matches.length&&matches[0].paypal_subscription_id!==id)return json({error:'Subscription mismatch; manual review required'},409);
 await admin(env,'study_subscriptions','POST',{user_id:uid,paypal_subscription_id:id,status:subscription.status,updated_at:new Date().toISOString()});
 return json({received:true});
 }catch(e){return json({error:e.message},500)}}
