import { json, required, paypal, getIntent, db, subscriptionDetails, writeStatus, patchIntent, validSubId, fail, ApiError } from './_shared.js';
const events = new Set([
  'BILLING.SUBSCRIPTION.CREATED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.RE-ACTIVATED',
  'BILLING.SUBSCRIPTION.UPDATED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.REVERSED', 'PAYMENT.SALE.REFUNDED'
]);
export async function onRequestPost({ request, env }) {
  try {
    required(env);
    if (!env.PAYPAL_WEBHOOK_ID) throw new ApiError('WEBHOOK_NOT_CONFIGURED', 'PayPal Sandbox Webhook ID is not configured.', 503);
    const event = await request.json();
    const h = request.headers;
    const names = ['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'];
    if (names.some(name => !h.get(name))) throw new ApiError('MISSING_SIGNATURE', 'Missing PayPal webhook verification headers.', 401);
    const verified = await paypal('/v1/notifications/verify-webhook-signature', env, 'POST', {
      auth_algo: h.get('paypal-auth-algo'), cert_url: h.get('paypal-cert-url'),
      transmission_id: h.get('paypal-transmission-id'), transmission_sig: h.get('paypal-transmission-sig'),
      transmission_time: h.get('paypal-transmission-time'), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event,
    });
    if (verified.verification_status !== 'SUCCESS') throw new ApiError('BAD_SIGNATURE', 'PayPal webhook signature did not verify.', 401);
    if (!events.has(event.event_type)) return json({ received: true, ignored: true });
    let id = event.event_type.startsWith('PAYMENT.') ? (event.resource?.billing_agreement_id || event.resource?.subscription_id) : event.resource?.id;
    if (!validSubId(id)) return json({ received: true, ignored: true });
    const attempt = await getIntent(env, id);
    let owner = attempt?.user_id;
    if (!owner) {
      const rows = await db(env, 'study_subscriptions', 'GET', '?select=user_id,paypal_subscription_id&paypal_subscription_id=eq.' + encodeURIComponent(id) + '&limit=1');
      owner = rows[0]?.user_id;
    }
    if (!owner) return json({ received: true, ignored: true, reason: 'not_linked' });
    const { status } = await subscriptionDetails(env, id, attempt, owner);
    await writeStatus(env, owner, id, status);
    if (attempt?.id) await patchIntent(env, attempt.id, status);
    return json({ received: true });
  } catch (e) { return fail(e); }
}
