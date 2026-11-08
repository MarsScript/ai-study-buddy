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

ALTER TABLE public.study_live_subscriptions
  ADD COLUMN IF NOT EXISTS premium_expires_at timestamptz;

-- The Stage 2 AI quota must not give Premium forever if a webhook stops arriving.
-- Only a verified paid subscription with an unexpired paid period can receive the higher limit.
CREATE OR REPLACE FUNCTION public.study_consume_ai_daily_quota(
  p_user_id uuid, p_live_plan_id text, p_free_limit integer, p_premium_limit integer
)
RETURNS TABLE(allowed boolean, used integer, daily_limit integer, premium boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_premium boolean;
  v_limit integer;
  v_used integer;
  v_day date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_user_id IS NULL OR p_live_plan_id IS NULL THEN
    RAISE EXCEPTION 'Invalid quota arguments';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.study_live_subscriptions s
    WHERE s.user_id=p_user_id
      AND s.status='ACTIVE'
      AND s.paypal_plan_id=p_live_plan_id
      AND s.verified_payment_id IS NOT NULL
      AND s.premium_expires_at > now()
  ) INTO v_is_premium;
  v_limit := CASE WHEN v_is_premium
    THEN LEAST(GREATEST(COALESCE(p_premium_limit,30),1),1000)
    ELSE LEAST(GREATEST(COALESCE(p_free_limit,5),1),1000) END;
  INSERT INTO public.study_ai_daily_usage (user_id,usage_day,used,updated_at)
    VALUES(p_user_id,v_day,1,now())
  ON CONFLICT(user_id,usage_day) DO UPDATE
    SET used=public.study_ai_daily_usage.used+1,updated_at=now()
    WHERE public.study_ai_daily_usage.used < v_limit
    RETURNING public.study_ai_daily_usage.used INTO v_used;
  IF v_used IS NOT NULL THEN
    RETURN QUERY SELECT true,v_used,v_limit,v_is_premium;
  ELSE
    SELECT t.used INTO v_used FROM public.study_ai_daily_usage t
      WHERE t.user_id=p_user_id AND t.usage_day=v_day;
    RETURN QUERY SELECT false,COALESCE(v_used,0),v_limit,v_is_premium;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.study_consume_ai_daily_quota(uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.study_consume_ai_daily_quota(uuid,text,integer,integer) TO service_role;
