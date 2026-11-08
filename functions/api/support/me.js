// Read-only capability check for a signed-in user.
import {json,fail,authorizedStaff} from './_shared.js';
export async function onRequestGet({request,env}){
  try{
    const staff=await authorizedStaff(request,env);
    return json({authorized:true,role:staff.role});
  }catch(e){return fail(e);}
}
