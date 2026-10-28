import {json,signedIn,paypal,configured,admin,validSubscriptionId,linkedSubscription} from './_shared.js';
export async function onRequestPost({request,env}){
 try{
  if(!configured(env))return json({error:'Sandbox is not configured'},503);
  const user=await signedIn(request,env);if(!user)return json({error:'Sign in first'},401);
  const {subscription_id:id}=await request.json();
  if(!validSubscriptionId(id))return json({error:'Invalid subscription ID'},400);
  // Only a subscription bound server-side during create checkout can be confirmed.
  const linked=await linkedSubscription(env,id,user.id);
  if(!linked)return json({error:'This test checkout is not linked to your student account. Please begin a NEW Sandbox checkout after the fix is deployed.'},403);
  const p=await paypal('/v1/billing/subscriptions/'+encodeURIComponent(id),env);
  if(p.id!==id||p.plan_id!==env.PAYPAL_PLAN_ID)return json({error:'PayPal subscription plan mismatch'},403);
  // custom_id is supplemental consistency validation; PayPal may omit it from its response.
  if(p.custom_id&&p.custom_id!==user.id)return json({error:'PayPal customer binding mismatch'},403);
  const status=p.status||'UNKNOWN';
  await admin(env,'study_subscriptions','PATCH',{status,updated_at:new Date().toISOString()},'?user_id=eq.'+encodeURIComponent(user.id)+'&paypal_subscription_id=eq.'+encodeURIComponent(id));
  return json({status,premium:status==='ACTIVE'});
 }catch(e){return json({error:e.message},500)}
}
