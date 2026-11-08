-- AI Study Buddy Live PayPal Stage 1. Run once in the existing Supabase SQL editor.
-- Does not change Sandbox tables, notes, flashcards, or quizzes.
create table if not exists public.study_live_subscriptions (
    user_id uuid primary key references auth.users(id) on delete cascade,
    paypal_subscription_id text not null unique,
    paypal_plan_id text not null,
    status text not null default 'UNKNOWN',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint live_paypal_sub_id_format check (paypal_subscription_id ~ '^I-[A-Za-z0-9]{6,64}$'),
    constraint live_paypal_plan_id_format check (paypal_plan_id ~ '^P-[A-Za-z0-9]+$')
);
create index if not exists idx_study_live_subscriptions_status on public.study_live_subscriptions(status);
alter table public.study_live_subscriptions enable row level security;
-- No browser user can read/write these records directly. Only trusted server-side service_role.
revoke all on table public.study_live_subscriptions from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.study_live_subscriptions to service_role;
