# AI Study Buddy — three-day PayPal Premium trial (staged, NOT LIVE)

**Do not enable live checkout yet.** This is a staged feature, not a payment launch.
Sandbox integrations, courtesy grants, the $3.99 rate, and current AI limits stay unchanged.

## Customer agreement
- The customer signs in to Study Buddy and selects **Start 3-day free trial with PayPal**.
- PayPal, not Study Buddy, collects/authorizes the payment method.
- First 3 days: **$0**; the approved PayPal subscription has a three-day TRIAL cycle.
- Beginning at the trial expiration: **$3.99 USD per month**, automatically renewing unless canceled before billing.
- One trial per Study Buddy account (tracked server-side). Multiple-account abuse requires additional controls before advertising.
- Cancel Trial is shown in the account; cancellation stops recurring billing and ends Premium access immediately. Also ensure users can cancel through their PayPal account.
- Premium AI daily limit remains **30/day** during the trial. The planned 300/day upgrade is separate and must not be advertised yet.

## Owner setup — when ready
1. Have the adult PayPal Business account owner create a **new** subscription plan for the *existing* AI Study Buddy Premium product. Do not modify or delete the previous LIVE $3.99 plan.
2. Set up exactly one **3-day $0 TRIAL cycle** (DAY x 3, total cycles 1, sequence 1); no setup fee.
3. Add an **unlimited REGULAR $3.99 USD MONTHLY cycle** (MONTH x 1, total cycles 0, sequence 2). Confirm that the first charge happens **after** the three days.
4. Save/activate the new plan and copy its **P-... plan ID** only. Never share your PayPal client secret, account password, or Supabase service-role key.
5. In Supabase SQL Editor, execute `sql/08_paypal_three_day_trial.sql`. It adds a restricted one-time redemption table, an expiring trial entitlement, and updates atomic AI limits; it does not process payments.
6. Merge the pull request and set Cloudflare Production `PAYPAL_LIVE_PLAN_ID` to the **new** trial-enabled plan ID, followed by redeployment. This changes only the target Live plan for **future** subscriptions. Before doing so, confirm that there are no existing paid subscribers on the old plan.
7. Keep `PAYPAL_LIVE_CHECKOUT_ENABLED` **false**. Open `/api/paypal-live/readiness`: check `three_day_free_trial: true`, `plan_status: ACTIVE`, `plan_preparation_ok: true`, and `live_checkout_enabled: false`.
8. Run no-charge automated tests (including `tests/paypal-three-day-trial.mjs` and the previous PayPal/entitlement tests), then test live checkout in a tightly controlled setting with the owner's authorization. A real Live agreement can lead to a charge on day four: do not use real billing details casually.
9. Before enabling checkout: verify webhook signature handling, immediate approved-trial access, one-time trial redemption, expiry at the correct time, first settled payment, failed billing, cancel before first bill, refund, account-owner matching, and new-user/trial abuse controls.
10. Arrange a trial-ending reminder before the first charge, publish clear renewal and cancellation terms, validate age/parental consent requirements, and confirm AI spend limits. Only after these checks should an adult account owner decide whether to enable checkout by setting `PAYPAL_LIVE_CHECKOUT_ENABLED=true`.

## Safety behavior
- With checkout flag false, **no Live subscription is created**, and the trial button is disabled.
- The checkout backend validates the PayPal plan is an active $0 three-day trial followed by $3.99/month. It rejects the old non-trial plan.
- The service does not store card numbers or PayPal passwords.
- Approved three-day trial access has an independently enforced expiry in Supabase, and does not count as a verified paid subscription.
- Real-money Premium still needs a completed $3.99 PayPal transaction. Never use an ACTIVE PayPal status by itself as proof of a settled charge.
