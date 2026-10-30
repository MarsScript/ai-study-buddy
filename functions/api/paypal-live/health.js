import {json, VERSION} from './_shared.js';
export async function onRequestGet(){
  return json({service:'AI Study Buddy Live PayPal (preparation only)',environment:'live',live_checkout_enabled:false,webhook_route:'/api/paypal-live/webhook',version:VERSION});
}
