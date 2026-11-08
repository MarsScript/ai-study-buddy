# Stage 3 — Live PayPal readiness (no real checkout)

This change adds a **read-only** endpoint:

\`GET /api/paypal-live/readiness\`

It calls PayPal's **Live** REST API using the server-only Live credentials already in Cloudflare, verifies the configured plan is fixed at $3.99 USD monthly, and reports whether that plan is still a draft or active.

## Safe deployment

1. Keep the existing Live plan in **Draft**. Do not enable live checkout yet.
2. Confirm the Cloudflare Preview deployment for this branch shows Success.
3. Open its deployment URL ending in \`/api/paypal-live/readiness\`.
4. Expected response while plan is in draft: \`"read_only":true\`, \`"live_checkout_enabled":false\`, \`"plan_monthly_usd_3_99":true\`, and a plan status such as \`CREATED\` (the REST API's equivalent of a draft).
5. Check that \`/api/paypal-live/health\` still responds and the Sandbox test subscription still works.

The endpoint deliberately performs **no write action** to PayPal and cannot charge or subscribe anyone. It does not expose client secrets or access tokens.

## Remaining before any live checkout

- Authenticated, idempotent subscription creation bound to exactly one student account.
- Reliable initial payment proof (not simply PayPal redirect or ACTIVE status).
- Verified signed webhook processing including failed payments, refunds, and cancellation.
- Frontend Buy/Manage subscription actions and safe return handling.
- Test cancellation, retries, payment failure, rate limits, and account isolation.
- Business owner approval and customer-facing terms, refund policy and tax review.
- Explicit enabling only after testing. Keep \`PAYPAL_LIVE_CHECKOUT_ENABLED\` unset or \`false\` for now.
