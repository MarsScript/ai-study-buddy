// Only the authenticated owner of a server-created intent can confirm a Live subscription.
import {json,failure,AppError} from './_shared.js';
import {authenticatedStudent,intentsForUser,reconcileLiveSubscription} from './_checkout.js';
const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x||''));

export async function onRequestPost({request,env}){
  try{
    const userId=await authenticatedStudent(request,env);
    if(Number(request.headers.get('content-length')||0)>4096)throw new AppError('PAYLOAD_TOO_LARGE',413);
    const data=await request.json().catch(()=>({}));
    const id=data?.checkout_id;
    if(!uuid(id))throw new AppError('INVALID_CHECKOUT_REFERENCE',400);
    const intents=await intentsForUser(env,userId);
    const intent=intents.find(x=>x.id===id);
    if(!intent?.paypal_subscription_id)throw new AppError('CHECKOUT_NOT_LINKED',404);
    const result=await reconcileLiveSubscription(env,intent);
    return json(result);
  }catch(e){return failure(e);}
}
