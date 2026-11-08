# Stage 3 — Live subscription checkout, guarded and OFF by default

**This branch is not a launch.** It adds backend code only; it has no Live checkout button and must not be activated before testing.

## First-time database migration (required)

Run \`sql/04_live_checkout_intents.sql\` once in the **same Supabase project** used by AI Study Buddy.

The migration:
- Adds \`study_live_checkout_intents\`, protected by RLS and service-role-only access.
- Guarantees at most one pending/active Live checkout intent per student.
- Stores confirmed payment ID and period expiry on \`study_live_subscriptions\`.
- Changes the Stage 2 quota RPC to allow 30 requests only for **verified, unexpired** Live Premium.

Expected Supabase SQL Editor result: \`Success. No rows returned\`.

## New endpoints

- \`POST /api/paypal-live/create\` — requires authenticated student and \`PAYPAL_LIVE_CHECKOUT_ENABLED=true\`, plus active $3.99 USD/month Live plan. Creates an ownership-bound PayPal subscription and returns approval URL. **OFF by default**.
- \`POST /api/paypal-live/confirm\` — authenticates student, verifies server-owned intent, checks PayPal subscription plan and custom ID, and checks an actual **COMPLETED** $3.99 USD transaction. ACTIVE alone is not enough.
- \`GET /api/paypal-live/status\` — authenticated read of stored subscription status, including time-limited Premium entitlement.
- \`POST /api/paypal-live/cancel\` — authenticated, ownership-checked cancellation. Remains available even with checkout disabled.
- \`POST /api/paypal-live/webhook\` — verifies the PayPal webhook signature; reconciles only previously linked subscriptions. Failed payments, cancellations and refunds fail closed.

## Never enable checkout yet

1. The PayPal Live plan currently returns \`CREATED\` (draft).
2. **Keep \`PAYPAL_LIVE_CHECKOUT_ENABLED\` unset or \`false\`.**
3. Do not activate the Live plan or create a paid subscription as a test without explicit authorization from the adult account owner.
4. The website's Premium page has a **Sandbox** test button only. A separate Live frontend, account display, and return/cancel flow still need to be added and tested.
5. The Live webhook currently subscribes to the eight Billing subscription events. Before launch, also select the **Payments** events \`PAYMENT.SALE.COMPLETED\`, \`PAYMENT.SALE.REFUNDED\` and \`PAYMENT.SALE.REVERSED\` for the existing Live REST app webhook.
6. Validate the Supabase migration and backend under Cloudflare Preview. A success badge does not prove billing correctness.
7. Test duplicate requests, signature rejections, payment failures, cancellations, refunds and webhook retries before taking money.

### Fail-closed behavior
- A missing Supabase table or payment API error denies premium instead of granting it.
- An uncertain PayPal subscription creation may leave an intent in CREATING; this intentionally blocks retry to avoid accidentally billing twice. Resolve manually after checking the PayPal merchant dashboard.
- Premium expires at the verified \`next_billing_time\` even if a webhook is missed; the paid-through expiry is checked by the database quota function.
- Real PayPal payment details are never accepted from query parameters or the browser as proof of purchase.

## Preview testing (after migration)

With checkout disabled:
- \`POST /api/paypal-live/create\` should return \`403 LIVE_CHECKOUT_DISABLED\`.
- \`GET /api/paypal-live/status\` without an Authorization header should return \`401 SIGN_IN_REQUIRED\`.
- \`POST /api/paypal-live/webhook\` with an unsigned fake event should return \`401 MISSING_PAYPAL_SIGNATURE\`.
- Existing Sandbox checkout and AI Free usage limits should still work.

**Review and test code before merging.** No Live checkout should be enabled until the UI and billing edge cases are covered.
