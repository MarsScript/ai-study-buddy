import { json, required, student, db, patchIntent, paypal, fail, intentsForUser, storedForUser, subscriptionDetails } from './_shared.js';
export async function onRequestPost({ request, env }) {
  try {
    required(env);
    const user = await student(request, env);
    // If a previous checkout is already active, avoid generating more recurring subscriptions.
    const recent = await intentsForUser(env, user.id);
    const previous = await storedForUser(env, user.id);
    const candidates = [ ...recent.slice(0, 4).map(a => ({ id: a.paypal_subscription_id, attempt: a })),
      ...(previous ? [{ id: previous.paypal_subscription_id, attempt: recent.find(a => a.paypal_subscription_id === previous.paypal_subscription_id) || null }] : []) ];
    for (const { id, attempt } of candidates) {
      if (!id) continue;
      try {
        const { status } = await subscriptionDetails(env, id, attempt, user.id);
        if (status === 'ACTIVE') return json({ already_active: true, status, premium: true });
      } catch (e) {
        if (!['PLAN_MISMATCH', 'INTENT_PLAN_MISMATCH', 'CUSTOM_ID_MISMATCH'].includes(e.code)) throw e;
      }
    }
    const inserted = await db(env, 'study_paypal_checkout_intents', 'POST', '', {
      user_id: user.id, paypal_plan_id: env.PAYPAL_PLAN_ID, status: 'CREATING',
    });
    const attempt = inserted[0];
    if (!attempt?.id) throw new Error('Could not save checkout intent');
    const origin = new URL(request.url).origin;
    const returnUrl = origin + '/?paypal_return=1&checkout_id=' + encodeURIComponent(attempt.id);
    const cancelUrl = origin + '/?paypal_cancel=1&checkout_id=' + encodeURIComponent(attempt.id);
    const subscription = await paypal('/v1/billing/subscriptions', env, 'POST', {
      plan_id: env.PAYPAL_PLAN_ID,
      custom_id: attempt.id, // Unpredictable server-created value bound to this authenticated student.
      application_context: { brand_name: 'AI Study Buddy (Sandbox)', user_action: 'SUBSCRIBE_NOW', return_url: returnUrl, cancel_url: cancelUrl },
    });
    const approve = subscription.links?.find(x => x.rel === 'approve')?.href;
    const target = approve ? new URL(approve) : null;
    if (!subscription.id || !approve || target.protocol !== 'https:' || target.hostname !== 'www.sandbox.paypal.com') {
      throw new Error('PayPal did not provide a valid Sandbox approval link');
    }
    await patchIntent(env, attempt.id, subscription.status || 'APPROVAL_PENDING', subscription.id);
    return json({ url: approve, subscription_id: subscription.id, checkout_id: attempt.id });
  } catch (e) { return fail(e); }
}
