// No-network contract tests for three-day Live PayPal trial eligibility.
import assert from 'node:assert/strict';
import {isThreeDayTrialPlan,approvedTrialExpiry} from '../functions/api/paypal-live/_checkout.js';
const plan={
  billing_cycles:[
    {tenure_type:'TRIAL',sequence:1,total_cycles:1,
     frequency:{interval_unit:'DAY',interval_count:3}},
    {tenure_type:'REGULAR',sequence:2,total_cycles:0,
     frequency:{interval_unit:'MONTH',interval_count:1},
     pricing_scheme:{fixed_price:{currency_code:'USD',value:'3.99'}}}
  ],
  payment_preferences:{setup_fee:{value:'0',currency_code:'USD'}}
};
assert.equal(isThreeDayTrialPlan(plan),true,'$0 three-day trial then $3.99/month');
assert.equal(isThreeDayTrialPlan({...plan,billing_cycles:[plan.billing_cycles[1]]}),false,'old non-trial plan must be rejected');
assert.equal(isThreeDayTrialPlan({...plan,billing_cycles:[{...plan.billing_cycles[0],frequency:{interval_unit:'DAY',interval_count:7}},plan.billing_cycles[1]]}),false,'trial must be three days');
assert.equal(isThreeDayTrialPlan({...plan,billing_cycles:[plan.billing_cycles[0],{...plan.billing_cycles[1],pricing_scheme:{fixed_price:{currency_code:'USD',value:'4.99'}}}]}),false,'price mismatch must be rejected');
assert.equal(isThreeDayTrialPlan({...plan,payment_preferences:{setup_fee:{value:'1',currency_code:'USD'}}}),false,'setup fees forbidden');
const start=Date.now()-60000;
const next=new Date(start+3*86400000).toISOString();
const details={
  status:'ACTIVE',start_time:new Date(start).toISOString(),
  billing_info:{next_billing_time:next,failed_payments_count:0}
};
const intent={created_at:new Date(start-120000).toISOString()};
const expiry=approvedTrialExpiry(details,intent);
assert.ok(expiry && Date.parse(expiry)>Date.now(),'verified active trial gets temporary access');
assert.equal(approvedTrialExpiry({...details,status:'CANCELLED'},intent),null,'cancelled trials never get access');
assert.equal(approvedTrialExpiry({...details,status:'SUSPENDED'},intent),null,'suspended trials never get access');
assert.equal(approvedTrialExpiry({...details,billing_info:{...details.billing_info,last_payment:{time:new Date().toISOString()}}},intent),null,'not a free trial once paid');
const expiredStart=start-4*86400000;
assert.equal(approvedTrialExpiry({...details,start_time:new Date(expiredStart).toISOString(),
  billing_info:{...details.billing_info,next_billing_time:new Date(expiredStart+3*86400000).toISOString()}},intent),
  null,'trial never extends beyond 72 hours');
console.log('PASS: PayPal three-day trial plan and entitlement contract tests (no money moved).');
