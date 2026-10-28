import { json, required, student, validSubId, validUuid, intentsForUser, resolveOwnership, subscriptionDetails, writeStatus, patchIntent, fail, ApiError } from './_shared.js';
export async function onRequestPost({ request, env }) {
  try {
    required(env);
    const user = await student(request, env);
    const body = await request.json().catch(() => ({}));
    const checkoutId = body.checkout_id;
    let subscriptionId = body.subscription_id;
    let known;
    if (checkoutId && !validUuid(checkoutId)) throw new ApiError('BAD_CHECKOUT_ID', 'Invalid checkout reference.');
    const attempts = await intentsForUser(env, user.id);
    if (checkoutId) {
      known = attempts.find(a => a.id === checkoutId);
      if (!known) throw new ApiError('CHECKOUT_NOT_FOUND', 'This checkout is not linked to your signed-in student account.', 403);
      if (subscriptionId && subscriptionId !== known.paypal_subscription_id) throw new ApiError('CHECKOUT_ID_MISMATCH', 'Checkout reference and subscription ID do not match.', 403);
      subscriptionId = known.paypal_subscription_id;
    } else if (!subscriptionId) {
      // Works even if sessionStorage was lost on the PayPal redirect.
      known = attempts.find(a => validSubId(a.paypal_subscription_id));
      subscriptionId = known?.paypal_subscription_id;
    }
    if (!validSubId(subscriptionId)) throw new ApiError('NO_CHECKOUT', 'No recent Sandbox checkout found for this account. Start a new checkout.', 404);
    const linked = known || await resolveOwnership(env, user.id, subscriptionId);
    const { status } = await subscriptionDetails(env, subscriptionId, linked, user.id);
    await writeStatus(env, user.id, subscriptionId, status);
    if (linked?.id) await patchIntent(env, linked.id, status);
    return json({ status, premium: status === 'ACTIVE', subscription_id: subscriptionId });
  } catch (e) { return fail(e); }
}
