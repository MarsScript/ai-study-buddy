// GET /api/ticket?id=<uuid> — read conversation belonging to student or Owner.
// POST /api/ticket — owner/student message, read, or owner-only status update.
import {json,fail,query,SupportError} from './support/_shared.js';
import {identity,payload,ticketFor,eq,publicTicket} from './ticket/_shared.js';
export async function onRequestGet({request,env}){
  try{
    const user=await identity(request,env);
    const ticket=await ticketFor(env,new URL(request.url).searchParams.get('id'),user);
    const rows=await query(env,'study_support_messages?select=id,sender_role,body,created_at&ticket_id='+eq(ticket.id)+'&order=id.asc&limit=200');
    return json({ticket:publicTicket(ticket,user.owner),messages:rows,can_reply:user.owner||ticket.status!=='resolved',owner:user.owner});
  }catch(e){return fail(e);}
}
export async function onRequestPost({request,env}){
  try{
    const user=await identity(request,env);
    const data=await payload(request);
    const ticket=await ticketFor(env,data?.ticket_id,user);
    const action=data?.action;
    if(action==='read'){
      await query(env,'rpc/study_mark_support_ticket_read',{method:'POST',body:{
        p_actor_user_id:user.id,p_ticket_id:ticket.id,p_as_owner:user.owner
      }});
      return json({ok:true});
    }
    if(action==='status'){
      if(!user.owner)throw new SupportError('OWNER_ONLY',403);
      if(!['open','in_progress','resolved'].includes(data.status))throw new SupportError('INVALID_STATUS',400);
      await query(env,'rpc/study_change_support_ticket_status',{method:'POST',body:{
        p_actor_user_id:user.id,p_ticket_id:ticket.id,p_status:data.status
      }});
      return json({updated:true});
    }
    if(action==='message'){
      const message=data?.message?.trim();
      if(typeof message!=='string'||message.length<1||message.length>4000)throw new SupportError('INVALID_MESSAGE',400);
      if(!user.owner&&ticket.status==='resolved')throw new SupportError('TICKET_RESOLVED',409);
      const rows=await query(env,'rpc/study_reply_support_ticket',{method:'POST',body:{
        p_actor_user_id:user.id,p_ticket_id:ticket.id,p_message:message,p_as_owner:user.owner
      }});
      if(!rows[0]?.message_id)throw new SupportError('MESSAGE_NOT_SAVED',503);
      return json({sent:true,message_id:rows[0].message_id});
    }
    throw new SupportError('INVALID_ACTION',400);
  }catch(e){return fail(e);}
}
