// In-app support is authenticated. Database tables are service-role-only.
import {actor,query,SupportError} from '../support/_shared.js';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const eq=x=>'eq.'+encodeURIComponent(x);
export async function identity(request,env){
  const user=await actor(request,env);
  const roles=await query(env,'study_support_roles?select=role&user_id='+eq(user.id)+'&limit=1');
  return {...user,owner:roles[0]?.role==='owner'};
}
export async function payload(request,maxBytes=5200){
  if(Number(request.headers.get('content-length')||0)>maxBytes)throw new SupportError('PAYLOAD_TOO_LARGE',413);
  const raw=await request.text();
  if(raw.length>maxBytes)throw new SupportError('PAYLOAD_TOO_LARGE',413);
  try{return JSON.parse(raw);}catch{throw new SupportError('INVALID_JSON',400)}
}
export async function ticketFor(env,id,user){
  if(!UUID.test(String(id||'')))throw new SupportError('INVALID_TICKET_ID',400);
  const rows=await query(env,'study_support_tickets?select=id,user_id,display_name,contact_email,subject,status,created_at,updated_at,last_message_at,last_message_sender,student_last_read_at,owner_last_read_at&id='+eq(id)+'&limit=1');
  const ticket=rows[0];
  if(!ticket||(!user.owner&&ticket.user_id!==user.id))throw new SupportError('TICKET_NOT_FOUND',404);
  return ticket;
}
export function publicTicket(t,owner){
  return {
    id:t.id,subject:t.subject,status:t.status,display_name:t.display_name,
    contact_email:owner?t.contact_email:undefined,
    created_at:t.created_at,updated_at:t.updated_at,last_message_at:t.last_message_at,
    unread:owner
      ? t.last_message_sender==='student'&&(!t.owner_last_read_at||Date.parse(t.owner_last_read_at)<Date.parse(t.last_message_at))
      : t.last_message_sender==='owner'&&(!t.student_last_read_at||Date.parse(t.student_last_read_at)<Date.parse(t.last_message_at))
  };
}
export function cleanError(e){return e instanceof SupportError?e:new SupportError('TICKET_OPERATION_FAILED',503)}
