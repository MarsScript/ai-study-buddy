# Support Admin setup — read-only, not enabled until SQL and owner enrollment

This feature is in a draft pull request. No owner/support accounts are automatically granted access. No Live payments are enabled.

## 1. Run the migration
In the AI Study Buddy Supabase SQL Editor run sql/05_support_readonly.sql. Expected: Success, no rows returned.

## 2. Assign your actual AI Study Buddy Supabase account as owner
Only someone authorized to administer this project should run the following SQL in Supabase SQL Editor. Replace the placeholder with the email you use to sign in to AI Study Buddy itself, not just PayPal:

    INSERT INTO public.study_support_roles (user_id,role)
    SELECT id,'owner' FROM auth.users
    WHERE lower(email)=lower('YOUR_AI_STUDY_BUDDY_LOGIN_EMAIL@example.com')
    ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role
    RETURNING user_id,role;

Exactly ONE row must be returned. If zero rows are returned, check the email; do not give the role to a different person's account. Never send passwords, private JWTs, or API keys to support.

## 3. Review and deploy
After the SQL and role assignment succeed, review the pull request and its automated authorization tests, then merge and confirm Cloudflare Production deployment.
Sign in with the owner account and look for Support Admin in the sidebar. Sign into an ordinary account and confirm it is hidden, and direct requests are rejected by the server.

## Support privileges
- Exact-email account lookup, requiring a support reason (8–280 characters).
- Read-only current Live Premium status, verified-payment flag, expiration date, recent checkout status and today's generation count.
- Every lookup is audited (including no-match lookups).
- No passwords, study notes, raw card data, full login impersonation, arbitrary billing status updates, PayPal checkout, or manually fabricated Premium entitlements.

## If a customer was charged but is not Premium
Ask them to use Verify a recent PayPal payment (no charge) while signed into the original student account. Investigate PayPal merchant transactions and webhook logs; don't tell them to pay twice. If no valid payment can be matched, process support/refund procedures instead of forging a receipt.

An optional future owner-only recovery action can reconcile against PayPal with an audit trail. Courtesy Premium should be a distinct time-limited grant and never be stored as a fake PayPal transaction.

Security: keep SUPABASE_SERVICE_ROLE_KEY/sb_secret_* exclusively on Cloudflare backend; protect the staff login with MFA and review audit logs.

To inspect recent audit logs in SQL Editor:
    SELECT action, created_at, actor_user_id, target_user_id
    FROM public.study_support_audit
    ORDER BY created_at DESC LIMIT 20;