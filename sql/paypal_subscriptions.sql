-- Run ONCE in the existing Supabase project's SQL Editor.
create table if not exists public.study_subscriptions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 paypal_subscription_id text not null unique,
 status text not null default 'APPROVAL_PENDING',
 updated_at timestamptz not null default now()
);
alter table public.study_subscriptions enable row level security;
revoke all on public.study_subscriptions from anon,authenticated;
grant select on public.study_subscriptions to authenticated;
drop policy if exists "Students read their subscription status" on public.study_subscriptions;
create policy "Students read their subscription status" on public.study_subscriptions for select to authenticated using (auth.uid()=user_id);
-- All changes are made server-side after PayPal validation, using the service role.
