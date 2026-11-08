-- AI Study Buddy Stage 2: atomic, per-account daily AI usage limits.
-- Run in the Supabase SQL Editor BEFORE merging/deploying the AI endpoint.
-- Requires the study_live_subscriptions table from Live PayPal Stage 1.

CREATE TABLE IF NOT EXISTS public.study_ai_daily_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_day date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, usage_day)
);

ALTER TABLE public.study_ai_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_ai_daily_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_ai_daily_usage TO service_role;

CREATE OR REPLACE FUNCTION public.study_consume_ai_daily_quota(
  p_user_id uuid,
  p_live_plan_id text,
  p_free_limit integer,
  p_premium_limit integer
)
RETURNS TABLE(allowed boolean, used integer, daily_limit integer, premium boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
  -- Real Premium only. A Sandbox Premium account never gets Live entitlements.
  SELECT EXISTS (
    SELECT 1 FROM public.study_live_subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status = 'ACTIVE'
      AND s.paypal_plan_id = p_live_plan_id
  ) INTO v_is_premium;
  v_limit := CASE WHEN v_is_premium
       THEN LEAST(GREATEST(COALESCE(p_premium_limit,30),1),1000)
       ELSE LEAST(GREATEST(COALESCE(p_free_limit,5),1),1000) END;
  -- This UPSERT is atomic, including when several browser requests arrive at once.
  INSERT INTO public.study_ai_daily_usage (user_id,usage_day,used,updated_at)
  VALUES (p_user_id,v_day,1,now())
  ON CONFLICT (user_id,usage_day) DO UPDATE
     SET used=public.study_ai_daily_usage.used+1,
         updated_at=now()
     WHERE public.study_ai_daily_usage.used < v_limit
  RETURNING public.study_ai_daily_usage.used INTO v_used;
  IF v_used IS NOT NULL THEN
    RETURN QUERY SELECT true, v_used, v_limit, v_is_premium;
  ELSE
    SELECT t.used INTO v_used FROM public.study_ai_daily_usage t
     WHERE t.user_id=p_user_id AND t.usage_day=v_day;
    RETURN QUERY SELECT false, COALESCE(v_used,0), v_limit, v_is_premium;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.study_consume_ai_daily_quota(uuid,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.study_consume_ai_daily_quota(uuid,text,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.study_refund_ai_daily_quota(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.study_ai_daily_usage
     SET used=GREATEST(used-1,0), updated_at=now()
   WHERE user_id=p_user_id AND usage_day=(now() AT TIME ZONE 'UTC')::date;
END;
$$;
REVOKE ALL ON FUNCTION public.study_refund_ai_daily_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.study_refund_ai_daily_quota(uuid) TO service_role;
