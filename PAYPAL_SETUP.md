# AI Study Buddy — PayPal Sandbox setup

This version is **Sandbox-only**. No live PayPal credentials or real-money checkout are supported. It does **not** yet enforce Premium AI usage limits. Do NOT launch a paid membership publicly on this basis.

## 1. Supabase
In your existing Supabase SQL Editor, run `sql/paypal_subscriptions.sql` once. This preserves your existing notes, flashcards and quiz tables.

## 2. Deploy Cloudflare Pages
Upload the `public/` and `functions/` directories exactly as supplied, replacing their prior files. Build output directory remains `public`. Keep your existing SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY, GEMINI_MODEL variables.

## 3. Cloudflare production variables/secrets
- `PAYPAL_CLIENT_ID` — Sandbox app's client ID (secret recommended)
- `PAYPAL_CLIENT_SECRET` — Sandbox client secret **Secret**
- `PAYPAL_PLAN_ID` — Sandbox billing plan ID (generated next)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service_role key **Secret**; server only, never public or in GitHub
- `PAYPAL_WEBHOOK_ID` — Sandbox webhook ID (add after endpoint is deployed)

These are exact variable names. Secrets must be set for Production and a new deployment must run to load them. Never post values in chat. The Supabase service_role key bypasses RLS; ensure it is configured only as a Cloudflare Secret.

## 4. Create Sandbox billing plan
Use `CREATE_PAYPAL_PLAN.mjs` from a trusted local terminal with Node.js 18+ and your Sandbox client credentials in shell environment variables. Run it once; copy its printed `PAYPAL_PLAN_ID` into Cloudflare. This creates a Sandbox service catalog product and a $3.99/month recurring plan. Do not run it with Live credentials. Never commit credentials to GitHub. You can alternatively create a plan directly via the PayPal REST API.

## 5. Register webhook (after deploying the endpoint)
At PayPal Developer Dashboard > Apps & Credentials > your Sandbox app > Sandbox Webhooks > Add Webhook:

`https://ai-study-buddy-9cz.pages.dev/api/paypal/webhook`

Select events: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.REVERSED`, `PAYMENT.SALE.REFUNDED`.

Copy the created webhook ID into `PAYPAL_WEBHOOK_ID` as a Cloudflare secret/text variable, then redeploy. Verify webhook signatures server-side via PayPal's API before updating the subscription table.

## 6. Test
Log in as a STUDENT on the website > Premium > Test Premium checkout (Sandbox). PayPal will open `sandbox.paypal.com`. Use a Sandbox **personal/buyer test account** from PayPal Developer > Testing Tools > Sandbox Accounts. Do not use your real PayPal password, card, or balance. After simulated approval, the page checks the Sandbox subscription and Supabase stores its status. Check status updates after cancelling a subscription in Sandbox.

## Important production limitations
- This is a development/test integration and needs end-to-end testing before any real launch.
- Current AI endpoints have **no enforced free-vs-Premium usage quotas**. Do not advertise higher or unlimited AI usage as implemented yet.
- Webhook receipt may be retried; PayPal status is fetched authoritatively before storing it.
- The website does not yet offer a fully featured subscription management/cancel interface.
- Switching to Live requires an eligible authorized merchant account, separate Live credentials and plan, comprehensive validation, usage limits, customer support/cancellation policy, and further security review.
