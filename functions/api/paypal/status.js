import { json, required, student, intentsForUser, storedForUser, subscriptionDetails, writeStatus, patchIntent, fail, ApiError } from './_shared.js';
export async function onRequestGet({ request, env }) {
  try {
    required(env);
    const user = await student(request, env);
    const previous = await storedForUser(env, user.id);
    const attempts = await intentsForUser(env, user.id);
    const ids = new Set();
    const candidates = [ ...attempts.map(a => ({ id: a.paypal_subscription_id, intent: a })),
      ...(previous ? [{ id: previous.paypal_subscription_id, intent: attempts.find(a => a.paypal_subscription_id === previous.paypal_subscription_id) || null }] : []) ];
    let latest = { status: 'FREE', premium: false };
    for (const item of candidates) {
      if (!item.id || ids.has(item.id)) continue;
      ids.add(item.id);
      let status;
      try {
        ({ status } = await subscriptionDetails(env, item.id, item.intent, user.id));
      } catch (e) {
        // Do not grant paid access for unverified subscriptions.
        if (e.code === 'PLAN_MISMATCH' || e.code === 'CUSTOM_ID_MISMATCH' || e.code === 'INTENT_PLAN_MISMATCH') continue;
        throw e;
      }
      if (latest.status === 'FREE') latest = { status, premium: false, subscription_id: item.id };
      if (item.intent?.id) await patchIntent(env, item.intent.id, status);
      if (status === 'ACTIVE') {
        await writeStatus(env, user.id, item.id, status);
        return json({ status, premium: true, subscription_id: item.id });
      }
    }
    // Reconcile existing row even after cancellation; never trust stale ACTIVE from database.
    if (previous && latest.status !== 'FREE') await writeStatus(env, user.id, latest.subscription_id, latest.status);
    return json(latest);
  } catch (e) { return fail(e); }
}
