// Stage 3 safe Live readiness check (read-only). No charge, checkout, or subscription activation.
import {json,config,paypal,AppError,failure} from './_shared.js';
import {isThreeDayTrialPlan} from './_checkout.js';

export async function onRequestGet({env}){
  try{
    config(env);
    const plan=await paypal(env,'/v1/billing/plans/'+encodeURIComponent(env.PAYPAL_LIVE_PLAN_ID));
    if(plan.id!==env.PAYPAL_LIVE_PLAN_ID)throw new AppError('LIVE_PLAN_ID_MISMATCH',502);
    const regular=(plan.billing_cycles||[]).filter(c=>c.tenure_type==='REGULAR');
    const cycle=regular[0];
    const fixed=cycle?.pricing_scheme?.fixed_price;
    const billingIsMonthly=regular.length===1 &&
      cycle.frequency?.interval_unit==='MONTH' &&
      Number(cycle.frequency?.interval_count)===1 &&
      Number(cycle.total_cycles)===0;
    const priceIsCorrect=fixed?.currency_code==='USD' && Number(fixed?.value)===3.99;
    const planActive=plan.status==='ACTIVE';
    const checkoutEnabled=env.PAYPAL_LIVE_CHECKOUT_ENABLED==='true';
    const trialConfigured=isThreeDayTrialPlan(plan);
    // This code purposefully does not ship a checkout endpoint. Health is not a payment audit.
    return json({
      service:'AI Study Buddy PayPal Live readiness',
      read_only:true,
      sandbox_unchanged:true,
      plan_status:plan.status,
      plan_monthly_usd_3_99:billingIsMonthly&&priceIsCorrect,
      three_day_free_trial:trialConfigured,
      live_checkout_enabled:false,
      checkout_flag_configured:checkoutEnabled,
      plan_preparation_ok:billingIsMonthly&&priceIsCorrect&&trialConfigured&&planActive,
      next_step:!billingIsMonthly||!priceIsCorrect
        ? 'REVIEW_LIVE_PLAN_PRICE_AND_FREQUENCY'
        : !trialConfigured?'CREATE_AND_CONFIGURE_3_DAY_TRIAL_PLAN'
        : !planActive?'KEEP_DRAFT_UNTIL_LIVE_CHECKOUT_IS_READY'
        :'REVIEW_AND_TEST_TRIAL_CHECKOUT_BEFORE_ENABLE'
    });
  }catch(e){return failure(e);}
}
