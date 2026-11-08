// AI Study Buddy staff auth — server-only. Never put Supabase secret keys in public/.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
export const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:jsonHeaders});
export class SupportError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export const fail=e=>{
  if(e instanceof SupportError)return json({error:e.code},e.status);
  console.error('[support] internal failure',e?.name||'Error');
  return json({error:'SUPPORT_UNAVAILABLE'},503);
};
function configuration(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||
     !(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY))throw new SupportError('SUPPORT_NOT_CONFIGURED',503);
}
export async function query(env,path,{method='GET',body}={}){
  configuration(env);
  // Construct paths server-side only: no browser-defined table names or RPCs.
  const secret=env.SUPABASE_SERVICE_ROLE_KEY;
  const headers={apikey:secret,'content-type':'application/json','accept':'application/json',prefer:'return=representation'};
  if(!secret.startsWith('sb_secret_'))headers.authorization='Bearer '+secret;
  const res=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
  if(!res.ok){console.error('[support] database request status',res.status);throw new SupportError('SUPPORT_DATABASE_UNAVAILABLE',503);}
  return res.status===204?[]:res.json().catch(()=>[]);
}
export async function actor(request,env){
  configuration(env);
  const jwt=request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if(!jwt)throw new SupportError('SIGN_IN_REQUIRED',401);
  const key=env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
  const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{
    headers:{apikey:key,authorization:'Bearer '+jwt}
  });
  if(!r.ok)throw new SupportError('SIGN_IN_REQUIRED',401);
  const data=await r.json();
  if(!UUID.test(String(data?.id||'')))throw new SupportError('SIGN_IN_REQUIRED',401);
  return data;
}
export async function authorizedStaff(request,env){
  const user=await actor(request,env);
  const roles=await query(env,'study_support_roles?select=role&user_id=eq.'+encodeURIComponent(user.id)+'&limit=1');
  const role=roles[0]?.role;
  if(role!=='owner'&&role!=='support')throw new SupportError('SUPPORT_ACCESS_DENIED',403);
  return {user_id:user.id,role};
}
