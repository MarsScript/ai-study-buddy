-- AI Study Buddy Stage 3: server-only PayPal Live checkout ownership.
-- Run in Supabase SQL Editor BEFORE merging the Stage 3 checkout endpoints.
-- Assumes sql/02_live_subscriptions.sql and sql/03_ai_daily_limits.sql have run.
-- This migration does not enable Live checkout or change any Sandbox table.

CREATE TABLE IF NOT EXISTS public.study_live_checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paypal_plan_id text NOT NULL CHECK (paypal_plan_id ~ '^P-[A-Za-z0-9]+$'),
  paypal_subscription_id text UNIQUE CHECK (paypal_subscription_id IS NULL OR paypal_subscription_id ~ '^I-[A-Za-z0-9]{6,64}$'),
  status text NOT NULL DEFAULT 'CREATING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Prevent multiple concurrently approvable recurring subscriptions for one student.
-- Stuck CREATING intents are intentionally blocked; don't silently retry a potential billing operation.
CREATE UNIQUE INDEX IF NOT EXISTS study_live_intents_one_pending_per_user
  ON public.study_live_checkout_intents (user_id)
  WHERE status IN ('CREATING','APPROVAL_PENDING','APPROVED','PAYMENT_PENDING','ACTIVE');

CREATE INDEX IF NOT EXISTS study_live_intents_user_created
  ON public.study_live_checkout_intents (user_id, created_at DESC);

ALTER TABLE public.study_live_checkout_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_live_checkout_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_live_checkout_intents TO service_role;

-- Only the backend writes confirmed payment evidence.
ALTER TABLE public.study_live_subscriptions
  ADD COLUMN IF NOT EXISTS verified_payment_id text;
