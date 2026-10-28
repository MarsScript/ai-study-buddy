// AI Study Buddy: PayPal Sandbox only. NEVER switch this constant to live by changing secrets.
export const VERSION = 'paypal-v3-2026-10-28';
export const PAYPAL_API = 'https://api-m.sandbox.paypal.com';
export const noCache = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
export const json = (data, status = 200) => new Response(JSON.stringify({ ...data, version: VERSION }), { status, headers: noCache });
export const validSubId = id => /^I-[A-Za-z0-9]+$/.test(String(id || ''));
export const validUuid = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));

export class ApiError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const fail = (e) => {
  // No API tokens, request bodies, PayPal credentials or service-role keys in browser errors.
  if (e instanceof ApiError) return json({ error: e.message, code: e.code }, e.status);
  console.error('[AI Study Buddy PayPal]', e?.message || 'unexpected failure');
  return json({ error: 'Payment verification encountered a server problem. Check Cloudflare Pages Functions logs.', code: 'SERVER_ERROR' }, 500);
};
export function required(env) {
  const keys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_PLAN_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = keys.filter(k => !env[k]);
  if (missing.length) throw new ApiError('CONFIG_MISSING', 'Sandbox configuration is missing: ' + missing.join(', '), 503);
}
export async function student(request, env) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) throw new ApiError('NOT_SIGNED_IN', 'Please sign in to AI Study Buddy first.', 401);
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + bearer },
  });
  if (!res.ok) throw new ApiError('AUTH_EXPIRED', 'Your login has expired. Sign in again.', 401);
  const person = await res.json();
  if (!validUuid(person?.id)) throw new ApiError('AUTH_INVALID', 'Invalid student session.', 401);
  return person;
}
async function accessToken(env) {
  const auth = btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET);
  const r = await fetch(PAYPAL_API + '/v1/oauth2/token', {
    method: 'POST', headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new ApiError('PAYPAL_AUTH', 'Could not authenticate with PayPal Sandbox. Verify your Sandbox Client ID and Secret.', 502);
  const data = await r.json();
  if (!data.access_token) throw new ApiError('PAYPAL_AUTH', 'PayPal did not provide an access token.', 502);
  return data.access_token;
}
export async function paypal(path, env, method = 'GET', body) {
  const key = await accessToken(env);
  const r = await fetch(PAYPAL_API + path, {
    method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const message = String(data?.message || 'PayPal request failed').slice(0, 160);
    throw new ApiError('PAYPAL_' + r.status, 'PayPal Sandbox: ' + message, 502);
  }
  return data;
}
export async function db(env, table, method = 'GET', query = '', payload) {
  if (!['study_subscriptions','study_paypal_checkout_intents'].includes(table)) throw new Error('Invalid table');
  const url = env.SUPABASE_URL + '/rest/v1/' + table + query;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates',
  };
  const r = await fetch(url, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    // Expose only PostgREST's safe error code, not SQL, passwords or customer data.
    const kind = (r.status === 404 || detail.code === '42P01') ? 'The checkout table is missing. Run sql/01_checkout_intents.sql in Supabase.' : 'Supabase returned ' + (detail.code || r.status) + '.';
    throw new ApiError('DATABASE_' + r.status, kind, 502);
  }
  if (r.status === 204) return [];
  return r.json().catch(() => []);
}
const eq = val => 'eq.' + encodeURIComponent(val);
export async function getIntent(env, subscriptionId) {
  const rows = await db(env, 'study_paypal_checkout_intents', 'GET', '?select=id,user_id,paypal_subscription_id,paypal_plan_id,status,created_at&paypal_subscription_id=' + eq(subscriptionId) + '&limit=1');
  return rows[0] || null;
}
export async function intentsForUser(env, userId) {
  return db(env, 'study_paypal_checkout_intents', 'GET', '?select=id,user_id,paypal_subscription_id,paypal_plan_id,status,created_at&user_id=' + eq(userId) + '&paypal_subscription_id=not.is.null&order=created_at.desc&limit=8');
}
export async function storedForUser(env, userId) {
  const rows = await db(env, 'study_subscriptions', 'GET', '?select=user_id,paypal_subscription_id,status&user_id=' + eq(userId) + '&limit=1');
  return rows[0] || null;
}
export async function writeStatus(env, userId, subscriptionId, status) {
  return db(env, 'study_subscriptions', 'POST', '?on_conflict=user_id', {
    user_id: userId, paypal_subscription_id: subscriptionId, status, updated_at: new Date().toISOString(),
  });
}
export async function patchIntent(env, intentId, status, subscriptionId) {
  const payload = { status, updated_at: new Date().toISOString() };
  if (subscriptionId) payload.paypal_subscription_id = subscriptionId;
  return db(env, 'study_paypal_checkout_intents', 'PATCH', '?id=' + eq(intentId), payload);
}
export function validateDetails(details, id, env, intent, userId) {
  if (details?.id !== id) throw new ApiError('PAYPAL_ID_MISMATCH', 'PayPal returned a different subscription ID.', 409);
  if (details?.plan_id !== env.PAYPAL_PLAN_ID) throw new ApiError('PLAN_MISMATCH', 'This subscription uses a different Sandbox plan. Check PAYPAL_PLAN_ID.', 409);
  if (intent && intent.paypal_plan_id !== env.PAYPAL_PLAN_ID) throw new ApiError('INTENT_PLAN_MISMATCH', 'Checkout was started for a different plan.', 409);
  const custom = details.custom_id;
  // PayPal can omit custom_id. The server-owned intent is authoritative if it does.
  if (custom && custom !== intent?.id && custom !== userId) throw new ApiError('CUSTOM_ID_MISMATCH', 'PayPal checkout reference is not linked to this student.', 403);
  return details.status || 'UNKNOWN';
}
export async function subscriptionDetails(env, id, intent, userId) {
  const d = await paypal('/v1/billing/subscriptions/' + encodeURIComponent(id), env);
  const status = validateDetails(d, id, env, intent, userId);
  return { status, details: d };
}
// Recover old checkouts safely only when PayPal itself explicitly identifies the signed-in student.
export async function resolveOwnership(env, userId, id) {
  const intent = await getIntent(env, id);
  if (intent) {
    if (intent.user_id !== userId) throw new ApiError('OTHER_STUDENT', 'This checkout belongs to another student. Sign into the original account.', 403);
    return intent;
  }
  const previous = await storedForUser(env, userId);
  if (previous?.paypal_subscription_id === id) return null;
  const details = await paypal('/v1/billing/subscriptions/' + encodeURIComponent(id), env);
  if (details.id !== id || details.plan_id !== env.PAYPAL_PLAN_ID || details.custom_id !== userId) {
    throw new ApiError('NOT_LINKED', 'Older checkout was not securely linked to this student. Start a new Sandbox checkout after this update.', 403);
  }
  // Verified legacy linkage: do not bypass the ownership check.
  const created = await db(env, 'study_paypal_checkout_intents', 'POST', '', {
    user_id: userId, paypal_subscription_id: id, paypal_plan_id: env.PAYPAL_PLAN_ID, status: details.status || 'UNKNOWN',
  });
  return created[0];
}
