// Support ticket API authorization regression tests. No PayPal, Supabase or network calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {onRequestGet as list, onRequestPost as open} from '../functions/api/tickets.js';
import {onRequestGet as detail, onRequestPost as change} from '../functions/api/ticket.js';

const OWNER='11111111-1111-4111-8111-111111111111';
const STUDENT='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const TICKET='44444444-4444-4444-8444-444444444444';
const OTHER_TICKET='55555555-5555-4555-8555-555555555555';
const env={
 SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_mock',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock'
};
let ownerWrites=[],tickets=[],messages=[];
const fakeNow='2026-11-08T12:00:00Z';
const asTicket=(id,user_id,subject)=>({
 id,user_id,subject,display_name:'Test Student',contact_email:user_id===OTHER?'other@example.test':'student@example.test',
 status:'open',created_at:fakeNow,updated_at:fakeNow,last_message_at:fakeNow,
 last_message_sender:'student',student_last_read_at:fakeNow,owner_last_read_at:null
});
tickets=[asTicket(TICKET,STUDENT,'Study guide help'),asTicket(OTHER_TICKET,OTHER,'Billing request')];
messages=[{id:1,ticket_id:TICKET,sender_role:'student',body:'My study guide is not saving.',created_at:fakeNow}];
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(raw,opt={})=>{
 const url=new URL(raw),path=url.pathname,qs=url.searchParams,method=opt.method||'GET';
 assert.equal(url.hostname,'example.supabase.co');
 if(path==='/auth/v1/user'){
  const token=opt.headers?.authorization?.split(' ').at(-1);
  if(token==='owner')return json({id:OWNER,email:'owner@example.test'});
  if(token==='student')return json({id:STUDENT,email:'student@example.test'});
  if(token==='other')return json({id:OTHER,email:'other@example.test'});
  return json({error:'not signed in'},401);
 }
 if(path==='/rest/v1/study_support_roles'){
  const roleId=qs.get('user_id')?.slice(3);
  return json(roleId===OWNER?[{role:'owner'}]:[]);
 }
 if(path==='/rest/v1/study_support_tickets'){
  let records=tickets;
  const id=qs.get('id')?.slice(3);
  const uid=qs.get('user_id')?.slice(3);
  if(id)records=records.filter(x=>x.id===id);
  if(uid)records=records.filter(x=>x.user_id===uid);
  return json(records);
 }
 if(path==='/rest/v1/study_support_messages'){
  return json(messages.filter(x=>x.ticket_id===qs.get('ticket_id')?.slice(3)));
 }
 if(path.startsWith('/rest/v1/rpc/study_')){
  const p=JSON.parse(opt.body);
  ownerWrites.push({path,p});
  if(path.endsWith('study_open_support_ticket')){
    assert.equal(p.p_user_id,STUDENT);
    assert.equal(p.p_email,'student@example.test');
    return json([{ticket_id:TICKET}]);
  }
  if(path.endsWith('study_reply_support_ticket')){
    assert.equal(p.p_ticket_id,TICKET);
    return json([{message_id:99}]);
  }
  if(path.endsWith('study_change_support_ticket_status')){
    assert.equal(p.p_actor_user_id,OWNER);
    return json([]);
  }
  if(path.endsWith('study_mark_support_ticket_read'))return json([]);
 }
 throw Error('Unexpected database path: '+path);
};
const get=(path,who)=>new Request('https://ai-study-buddy-9cz.pages.dev'+path,
 {headers:who?{authorization:'Bearer '+who}:{}});
const post=(path,who,body)=>new Request('https://ai-study-buddy-9cz.pages.dev'+path,{
 method:'POST',headers:{'content-type':'application/json',...(who?{authorization:'Bearer '+who}:{})},
 body:JSON.stringify(body)
});
async function expect(label,handler,request,code,error){
 const response=await handler({request,env});
 assert.equal(response.status,code,label);
 const data=await response.json();
 if(error)assert.equal(data.error,error,label);
 console.log('PASS',label,code);
 return data;
}
await expect('Anonymous cannot list requests',list,get('/api/tickets'),401,'SIGN_IN_REQUIRED');
await expect('Student cannot read owner inbox',list,get('/api/tickets?scope=owner','student'),403,'OWNER_ONLY');
const own=await expect('Student lists own ticket',list,get('/api/tickets','student'),200);
assert.equal(own.tickets.length,1);
assert.equal(own.tickets[0].id,TICKET);
const all=await expect('Owner lists all support tickets',list,get('/api/tickets?scope=owner','owner'),200);
assert.equal(all.tickets.length,2);
await expect('Cannot read another student ticket',detail,get('/api/ticket?id='+OTHER_TICKET,'student'),404,'TICKET_NOT_FOUND');
const view=await expect('Student can read own conversation',detail,get('/api/ticket?id='+TICKET,'student'),200);
assert.equal(view.messages[0].body,'My study guide is not saving.');
await expect('Cannot impersonate another account email',open,post('/api/tickets','student',{
 name:'Student',email:'other@example.test',subject:'Question',message:'Please help with my homework'}),400,'INVALID_TICKET_FIELDS');
assert.equal(ownerWrites.length,0);
const created=await expect('Student can create ticket using own email',open,post('/api/tickets','student',{
 name:'Student',email:'student@example.test',subject:'Question',message:'My summaries are not showing up.'}),201);
assert.equal(created.ticket_id,TICKET);
await expect('Student cannot change ticket status',change,post('/api/ticket','student',{
 action:'status',ticket_id:TICKET,status:'resolved'}),403,'OWNER_ONLY');
await expect('Student cannot reply on other ticket',change,post('/api/ticket','student',{
 action:'message',ticket_id:OTHER_TICKET,message:'Please change another ticket'}),404,'TICKET_NOT_FOUND');
const wrote=await expect('Student can reply to own ticket',change,post('/api/ticket','student',{
 action:'message',ticket_id:TICKET,message:'Additional details on this issue'}),200);
assert.equal(wrote.sent,true);
assert.equal(ownerWrites.find(x=>x.path.endsWith('study_reply_support_ticket'))?.p.p_as_owner,false);
await expect('Owner can reply to a student',change,post('/api/ticket','owner',{
 action:'message',ticket_id:TICKET,message:'I can help with this issue.'}),200);
assert.equal(ownerWrites.filter(x=>x.path.endsWith('study_reply_support_ticket')).at(-1).p.p_as_owner,true);
await expect('Owner can resolve ticket',change,post('/api/ticket','owner',{
 action:'status',ticket_id:TICKET,status:'resolved'}),200);
await expect('Owner can mark read',change,post('/api/ticket','owner',{
 action:'read',ticket_id:TICKET}),200);
const q=fs.readFileSync(new URL('../sql/07_inapp_support_tickets.sql',import.meta.url),'utf8');
for(const phrase of [
 'study_support_tickets ENABLE ROW LEVEL SECURITY',
 'study_support_messages ENABLE ROW LEVEL SECURITY',
 'FROM PUBLIC,anon,authenticated',
 "r.role='owner'",
 'study_open_support_ticket',
 'study_reply_support_ticket',
 'study_change_support_ticket_status',
 'study_mark_support_ticket_read',
 'TOO_MANY_OPEN_TICKETS',
 'TICKET_ACCESS_DENIED'
])assert.ok(q.includes(phrase),'Missing ticket SQL safeguard: '+phrase);
const page=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
for(const id of ['view-help','ticket-new-form','ticket-email','ticket-message','student-ticket-list','student-ticket-conversation',
 'support-owner-inbox','owner-ticket-list','owner-ticket-conversation','owner-ticket-reply'])assert.ok(page.includes('id="'+id+'"'),'Missing UI: '+id);
const styles=fs.readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const appended=styles.split('/* Stage 7 layout polish')[1]||'';
assert.ok(appended.length>1000);
assert.equal(/#[a-f0-9]{3,8}\b/i.test(appended),false,'New design CSS must not introduce new hex colors.');
assert.ok(appended.includes('prefers-reduced-motion'));
console.log('Support API role isolation and palette preservation tests passed.');
