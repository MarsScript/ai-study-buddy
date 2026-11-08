# Stage 6 — Owner-only complimentary Premium (no PayPal charge)

**Do not deploy before running the SQL migration.** The Live PayPal plan and checkout switch remain unchanged.

## What is being added
- A **Grant complimentary Premium** action available only to authenticated Support Admin users with server-authorized `owner` role.
- A matching **Revoke complimentary Premium** action.
- 1-, 7-, and 30-day grants, with automatic expiration and mandatory reason plus typed confirmation of the exact student email.
- A separate database record, not a PayPal subscription. No PayPal API calls or payment evidence are fabricated.
- An audited SQL transaction for every grant/revoke. If the audit insert fails, the Premium change rolls back too.
- Students receive the ordinary Premium AI daily limit (default 30) while the courtesy record is active. An expired or revoked record returns to the Free limit (default 5).
- Student Premium page displays "Premium (Complimentary)" with expiration; paid status stays separate.
- Ordinary students get no Support Admin menu and 403 on privileged API calls. Staff with `support` role can look up but cannot grant/revoke.

## Step 1 — Supabase
Run `sql/06_complimentary_premium.sql` in the SAME AI Study Buddy Supabase project used by the website.
Expected: `Success. No rows returned.`
The migration adds the `study_complimentary_premium` table, updates the support audit action check, installs the owner-only atomic grant/revoke RPC, and extends the existing atomic quota RPC to count paid OR active courtesy Premium.

## Step 2 — GitHub / Cloudflare
Check the automated tests on the draft pull request and merge only AFTER SQL succeeds. Check Cloudflare Production deployment success and verify no real checkout button appears.

## Step 3 — Safe end-to-end test
1. Sign up for a **different** student account in a private window or another browser. Do NOT grant it the `owner` role.
2. Confirm it has no Support Admin option. Direct attempts to access the privileged API should get 403.
3. Sign into the Owner account in your normal browser, open Support Admin and search for that student's exact email with a legitimate test reason.
4. Enter a courtesy-grant reason, select 1 day for the first test, click Grant, confirm, and retype the student email.
5. Verify the staff dashboard now shows Complimentary Premium: ACTIVE and an expiration date.
6. Refresh the ordinary student session. Premium page should say `Premium (Complimentary)` and no PayPal charge.
7. Generate one study guide. AI usage message should show `/ 30`. Use Supabase SQL Editor to inspect the quota record if necessary. Do NOT spend all 30 requests for testing.
8. In the Owner dashboard select Revoke, confirm the student email, then refresh the student session. The limit should return to `/ 5` (if the daily used count has not already reached 5); the student should no longer show Complimentary Premium.

## Security
- This feature never creates/edits a PayPal subscription or attempts a payment.
- Never grant an owner role to the test student; grant only via an authorized Owner account.
- Time-limited grants are explicit complimentary benefits, NOT evidence of payment.
- All grant/revoke changes are audit logged in `study_support_audit`, distinct from CUSTOMER_LOOKUP events.
- SQL grants to service_role only; public users cannot read/write courtesy tables directly.
- Backend checks the signed-in owner role on each request; SQL RPC separately enforces owner role and exact email confirmation.
- Never put Supabase service-role keys in the browser or paste them into ChatGPT.

## Customer support policy
Use verified PayPal reconciliation and merchant billing records for someone who **actually paid but has missing access**. A courtesy grant can be used as a deliberate, separately labeled temporary benefit while you investigate, not as a false statement that payment was received.