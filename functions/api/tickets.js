// GET /api/tickets — own tickets (or Owner inbox with scope=owner)
// POST /api/tickets — open a request. No email service, no anonymous messages.
import {json,fail,query,SupportError} from './support/_shared.js';
import {identity,payload,eq,publicTicket} from './ticket/_shared.js';
export async function onRequestGet({request,env}){
  try{
    const user=await identity(request,env);
    const isInbox=new URL(request.url).searchParams.get('scope')==='owner';
    if(isInbox&&!user.owner)throw new SupportError('OWNER_ONLY',403);
    const rows=await query(env,'study_support_tickets?select=id,user_id,display_name,contact_email,subject,status,created_at,updated_at,last_message_at,last_message_sender,student_last_read_at,owner_last_read_at'+
      (isInbox?'':'&user_id='+eq(user.id))+'&order=last_message_at.desc&limit=100');
    return json({tickets:rows.map(t=>publicTicket(t,isInbox)),scope:isInbox?'owner':'student'});
  }catch(e){return fail(e);}
}
export async function onRequestPost({request,env}){
  try{
    const user=await identity(request,env);
    const data=await payload(request);
    const display_name=data?.name?.trim();
    const email=data?.email?.trim();
    const subject=data?.subject?.trim()||'Support request';
    const message=data?.message?.trim();
    if(typeof display_name!=='string'||display_name.length<2||display_name.length>80||
      typeof email!=='string'||email.length<3||email.length>254||
      email.toLowerCase()!==user.email?.toLowerCase()||
      typeof subject!=='string'||subject.length<3||subject.length>120||
      typeof message!=='string'||message.length<10||message.length>4000)throw new SupportError('INVALID_TICKET_FIELDS',400);
    const rows=await query(env,'rpc/study_open_support_ticket',{method:'POST',body:{
      p_user_id:user.id,p_name:display_name,p_email:email,p_subject:subject,p_message:message
    }});
    if(!rows[0]?.ticket_id)throw new SupportError('TICKET_NOT_CREATED',503);
    return json({created:true,ticket_id:rows[0].ticket_id},201);
  }catch(e){return fail(e);}
}
