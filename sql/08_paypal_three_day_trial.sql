-- Stage 8 — a single three-day PayPal trial after payment-method approval.
-- Execute in Supabase SQL Editor BEFORE deploying trial checkout.
-- Requires Stage 6 and all earlier migrations. No payment or checkout is activated.
ALTER TABLE public.study_live_subscriptions
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.study_trial_redemptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  paypal_subscription_id text NOT NULL UNIQUE CHECK (paypal_subscription_id ~ '^I-[A-Za-z0-9]{6,64}$'),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.study_trial_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_trial_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_trial_redemptions TO service_role;

-- Count a running trial as pending, so another recurring agreement cannot be opened.
DROP INDEX IF EXISTS public.study_live_intents_one_pending_per_user;
CREATE UNIQUE INDEX study_live_intents_one_pending_per_user
  ON public.study_live_checkout_intents (user_id)
  WHERE status IN ('CREATING','APPROVAL_PENDING','APPROVED','PAYMENT_PENDING','TRIAL_ACTIVE','ACTIVE');

-- Same atomic quota as Stage 3. A verified paid entitlement OR a currently-active
-- separate complimentary grant receives the configured Premium limit.
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
  SELECT (
    EXISTS (
      SELECT 1 FROM public.study_live_subscriptions s
      WHERE s.user_id=p_user_id AND s.status='ACTIVE'
        AND s.paypal_plan_id=p_live_plan_id
        AND s.verified_payment_id IS NOT NULL AND s.premium_expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM public.study_live_subscriptions t
      WHERE t.user_id=p_user_id AND t.status='TRIAL_ACTIVE'
        AND t.paypal_plan_id=p_live_plan_id
        AND t.trial_expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM public.study_complimentary_premium c
      WHERE c.user_id=p_user_id AND c.revoked_at IS NULL AND c.expires_at > now()
    )
  ) INTO v_is_premium;
  v_limit := CASE WHEN v_is_premium
    THEN LEAST(GREATEST(COALESCE(p_premium_limit,30),1),1000)
    ELSE LEAST(GREATEST(COALESCE(p_free_limit,5),1),1000) END;
  INSERT INTO public.study_ai_daily_usage(user_id,usage_day,used,updated_at)
    VALUES(p_user_id,v_day,1,now())
  ON CONFLICT(user_id,usage_day) DO UPDATE
    SET used=public.study_ai_daily_usage.used+1,updated_at=now()
    WHERE public.study_ai_daily_usage.used < v_limit
    RETURNING public.study_ai_daily_usage.used INTO v_used;
  IF v_used IS NOT NULL THEN
    RETURN QUERY SELECT true,v_used,v_limit,v_is_premium;
  ELSE
    SELECT t.used INTO v_used
      FROM public.study_ai_daily_usage t
      WHERE t.user_id=p_user_id AND t.usage_day=v_day;
    RETURN QUERY SELECT false,COALESCE(v_used,0),v_limit,v_is_premium;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.study_consume_ai_daily_quota(uuid,text,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.study_consume_ai_daily_quota(uuid,text,integer,integer)
  TO service_role;

