# Stage 7 — Support Inbox and layout polish

**This branch requires a Supabase SQL migration before deploying.** Do not merge before `sql/07_inapp_support_tickets.sql` runs successfully in the existing AI Study Buddy Supabase project.

## What students get
- A **Help & inbox** page accessible when signed in.
- Submit a support request with name, their authenticated account email, a topic, and a message.
- Browse their own request history, open a conversation, read the owner's replies and send follow-up messages.
- Unread reply badge updates while the tab is open (60-second refresh and on browser refocus), or by clicking Refresh.
- Resolved requests remain readable but cannot receive new student replies; they can open a new request for a new issue.
- **No separate email service** and no claim of email notifications. Replies remain inside the app.

## What the owner gets
- Existing Support Admin retains billing lookup and complimentary Premium grant/revoke.
- A new **Support inbox** at the top, with all tickets and unread count.
- Owner-only replies and Open / In progress / Resolved status management.
- Other users cannot view or change a different student's tickets, even through API calls.

## Data security
- Signed-in Supabase JWT required for all endpoints.
- Ticket ownership is enforced on the server, before message lookup.
- Owner privileges are checked against the existing server-side `study_support_roles` database.
- SQL RPCs also check the owner and student identities for writes.
- Supabase tables and functions are inaccessible to anon or authenticated roles directly; only service_role can read/write.
- Opening a ticket is limited to 8 requests per 24h and 5 unresolved requests per user. Replies limited to 30 per hour per sender. Text length limits prevent oversized messages.
- No passwords, credit card data, or access tokens are stored in tickets. Support should never ask students to send secrets.

## Style
- Same existing CSS variables/hex palette. Only layout, spacing, alignment, cards, responsive design and reduced-motion-aware entry/transitions adjusted.
- Changes also improve the crowded admin forms.

## Rollout
1. Run `sql/07_inapp_support_tickets.sql` in Supabase SQL Editor. Confirm **Success. No rows returned**.
2. Review GitHub PR and CI results. Only after SQL succeeds, merge to main.
3. Verify Cloudflare Production deployment success.
4. Create an ordinary test account (do NOT grant owner role). Submit a request in Help & inbox.
5. In the Owner account's Support Admin → Support inbox, open it, reply, set status In progress, then Resolved.
6. Refresh the test student's Help & inbox. Verify the reply and status are visible.
7. Sign into another test account; verify it cannot read the first student's ticket.
8. Check all study features and the **7/30** AI Premium test still function.
9. Verify mobile layout and animations. System `prefers-reduced-motion` disables animation.

**Real PayPal checkout remains disabled.** This update does not change PayPal credentials, billing states, plans, or quota rules.
