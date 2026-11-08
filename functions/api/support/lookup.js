// Audited, exact-email, minimal billing-status lookup. No passwords or study notes.
import {json,fail,authorizedStaff,query,SupportError} from './_shared.js';
const isEmail=s=>typeof s==='string'&&s.length>=3&&s.length<=254&&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eq=value=>'eq.'+encodeURIComponent(value);
export async function onRequestPost({request,env}){
  try{
    const staff=await authorizedStaff(request,env);
    if(Number(request.headers.get('content-length')||0)>2000)throw new SupportError('PAYLOAD_TOO_LARGE',413);
    const raw=await request.text();
    if(raw.length>2000)throw new SupportError('PAYLOAD_TOO_LARGE',413);
    let body;
    try{body=JSON.parse(raw);}catch{throw new SupportError('INVALID_JSON',400);}
    const email=body?.email?.trim();
    const reason=body?.reason?.trim();
    if(!isEmail(email))throw new SupportError('INVALID_CUSTOMER_EMAIL',400);
    if(typeof reason!=='string'||reason.length<8||reason.length>280)throw new SupportError('SUPPORT_REASON_REQUIRED',400);
    const found=await query(env,'rpc/study_support_find_customer',{
      method:'POST',body:{p_email:email}
    });
    const customer=found[0]||null;
    if(customer&&!UUID.test(customer.user_id))throw new SupportError('INVALID_DATABASE_RESPONSE',503);
    // Always audit a customer lookup, even when there was no matching account.
    // No email or other PII in the audit entry beyond the optional target user UUID.
    await query(env,'study_support_audit',{method:'POST',body:{
      actor_user_id:staff.user_id,target_user_id:customer?.user_id||null,
      action:'CUSTOMER_LOOKUP',reason
    }});
    if(!customer)return json({found:false});
    const [paid,pending,usage,courtesy]=await Promise.all([
      query(env,'study_live_subscriptions?select=status,paypal_plan_id,verified_payment_id,premium_expires_at,updated_at&user_id='+eq(customer.user_id)+'&limit=1'),
      query(env,'study_live_checkout_intents?select=status,created_at,updated_at&user_id='+eq(customer.user_id)+'&order=created_at.desc&limit=3'),
      query(env,'study_ai_daily_usage?select=usage_day,used&user_id='+eq(customer.user_id)+'&usage_day=eq.'+new Date().toISOString().slice(0,10)+'&limit=1'),
      query(env,'study_complimentary_premium?select=expires_at,revoked_at,granted_at&user_id='+eq(customer.user_id)+'&limit=1')
    ]);
    const p=paid[0];
    const premium=!!(p?.status==='ACTIVE'&&p.paypal_plan_id===env.PAYPAL_LIVE_PLAN_ID&&p.verified_payment_id&&
      Date.parse(p.premium_expires_at)>Date.now());
    return json({
      found:true,account:{email:customer.email,registered_at:customer.registered_at},
      live:{premium,status:p?.status||'FREE',payment_verified:!!p?.verified_payment_id,
        paid_until:premium?p.premium_expires_at:null,last_updated_at:p?.updated_at||null},
      recent_checkout_status:pending[0]?.status||null,
      complimentary:{active:!!(courtesy[0] && !courtesy[0].revoked_at && Date.parse(courtesy[0].expires_at)>Date.now()), expires_at: courtesy[0]&&!courtesy[0].revoked_at&&Date.parse(courtesy[0].expires_at)>Date.now()?courtesy[0].expires_at:null},
      ai_generations_today:usage[0]?.used||0
    });
  }catch(e){return fail(e);}
}
