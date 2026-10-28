import {json,paypal,signedIn,configured,admin} from './_shared.js';
export async function onRequestPost({request,env}){
 try{
  if(!configured(env))return json({error:'Sandbox payments are not configured yet.'},503);
  const user=await signedIn(request,env);if(!user)return json({error:'Sign in first.'},401);
  const origin=new URL(request.url).origin;
  const subscription=await paypal('/v1/billing/subscriptions',env,'POST',{
   plan_id:env.PAYPAL_PLAN_ID,custom_id:user.id,
   application_context:{brand_name:'AI Study Buddy (Sandbox)',user_action:'SUBSCRIBE_NOW',return_url:origin+'/?paypal_return=1',cancel_url:origin+'/?paypal_cancel=1'}
  });
  const approve=subscription.links?.find(x=>x.rel==='approve')?.href;
  if(!subscription.id||!approve||!approve.startsWith('https://www.sandbox.paypal.com/'))return json({error:'PayPal did not return a sandbox checkout URL'},502);
  // Bind this subscription to the authenticated student BEFORE sending them to PayPal.
  // Never trust a browser-submitted subscription ID as proof of ownership.
  await admin(env,'study_subscriptions','POST',{
   user_id:user.id,paypal_subscription_id:subscription.id,status:subscription.status||'APPROVAL_PENDING',updated_at:new Date().toISOString()
  },'?on_conflict=user_id');
  return json({url:approve,subscription_id:subscription.id});
 }catch(e){return json({error:e.message},500)}
}
