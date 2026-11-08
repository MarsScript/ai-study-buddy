// Owner-only courtesy Premium. This NEVER creates a PayPal subscription or receipt.
import {json,fail,authorizedStaff,query,SupportError} from './_shared.js';
const validEmail=s=>typeof s==='string'&&s.length>=3&&s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export async function onRequestPost({request,env}){
  try{
    const staff=await authorizedStaff(request,env);
    if(staff.role!=='owner')throw new SupportError('OWNER_ONLY',403);
    if(Number(request.headers.get('content-length')||0)>3000)throw new SupportError('PAYLOAD_TOO_LARGE',413);
    const raw=await request.text();
    if(raw.length>3000)throw new SupportError('PAYLOAD_TOO_LARGE',413);
    let data;
    try{data=JSON.parse(raw);}catch{throw new SupportError('INVALID_JSON',400);}
    const email=data?.email?.trim();
    const confirmation=data?.confirm_email?.trim();
    const reason=data?.reason?.trim();
    const action=data?.action;
    const days=data?.days;
    if(!validEmail(email)||!validEmail(confirmation)||
      email.toLowerCase()!==confirmation.toLowerCase())throw new SupportError('CONFIRM_CUSTOMER_EMAIL',400);
    if(typeof reason!=='string'||reason.length<12||reason.length>280)throw new SupportError('REASON_REQUIRED',400);
    if(!['grant','revoke'].includes(action))throw new SupportError('INVALID_ACTION',400);
    if(action==='grant'&&![1,7,30].includes(days))throw new SupportError('INVALID_GRANT_DAYS',400);
    const records=await query(env,'rpc/study_owner_change_complimentary_premium',{
      method:'POST',
      body:{
        p_actor_user_id:staff.user_id,
        p_email:email,p_confirm_email:confirmation,
        p_action:action,p_days:action==='grant'?days:null,p_reason:reason
      }
    });
    const record=records[0];
    if(!record||record.customer_email?.toLowerCase()!==email.toLowerCase()){
      throw new SupportError('GRANT_VERIFICATION_FAILED',503);
    }
    return json({
      success:true,
      account_email:record.customer_email,
      complimentary_active:record.complimentary_active===true,
      complimentary_expires_at:record.complimentary_active?record.ends_at:null,
      note:'This is a complimentary Premium benefit, not a paid PayPal subscription. The action is audited.'
    });
  }catch(e){return fail(e);}
}
