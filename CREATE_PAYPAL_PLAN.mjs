// Node 18+; run LOCALLY, never commit real credentials.
// PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node CREATE_PAYPAL_PLAN.mjs
const id=process.env.PAYPAL_CLIENT_ID,secret=process.env.PAYPAL_CLIENT_SECRET;
if(!id||!secret){console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your terminal first.');process.exit(1)}
const base='https://api-m.sandbox.paypal.com';
async function req(path,method='GET',body,access){const h={'content-type':access?'application/json':'application/x-www-form-urlencoded','accept':'application/json'};if(access)h.authorization='Bearer '+access;else h.authorization='Basic '+Buffer.from(id+':'+secret).toString('base64');const r=await fetch(base+path,{method,headers:h,body:typeof body==='string'?body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(r.status+' '+JSON.stringify(j));return j;}
const t=await req('/v1/oauth2/token','POST','grant_type=client_credentials');
const product=await req('/v1/catalogs/products','POST',{name:'AI Study Buddy Premium (TEST)',description:'Sandbox software subscription test',type:'SERVICE',category:'SOFTWARE'},t.access_token);
const plan=await req('/v1/billing/plans','POST',{product_id:product.id,name:'AI Study Buddy Premium - Sandbox $3.99/month',status:'ACTIVE',billing_cycles:[{frequency:{interval_unit:'MONTH',interval_count:1},tenure_type:'REGULAR',sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{value:'3.99',currency_code:'USD'}}}],payment_preferences:{auto_bill_outstanding:true,setup_fee:{value:'0',currency_code:'USD'},setup_fee_failure_action:'CONTINUE',payment_failure_threshold:3}},t.access_token);
console.log('PAYPAL_PLAN_ID='+plan.id);
