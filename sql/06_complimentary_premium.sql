-- Stage 6 — Owner-only, expiring complimentary Premium (no PayPal subscription).
-- Run in Supabase SQL Editor BEFORE merging the Stage 6 GitHub PR.
-- Does not edit real PayPal subscriptions, plan IDs, or payment evidence.
-- Existing owner role: study_support_roles.role = 'owner'.

CREATE TABLE IF NOT EXISTS public.study_complimentary_premium (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 12 AND 280),
  CONSTRAINT valid_complimentary_period CHECK (expires_at > granted_at)
);
ALTER TABLE public.study_complimentary_premium ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_complimentary_premium FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_complimentary_premium TO service_role;

-- Support events are separately labeled. We never label a courtesy grant "PAID".
ALTER TABLE public.study_support_audit
  DROP CONSTRAINT IF EXISTS study_support_audit_action_check;
ALTER TABLE public.study_support_audit
  ADD CONSTRAINT study_support_audit_action_check
    CHECK (action IN ('CUSTOMER_LOOKUP', 'COURTESY_GRANTED', 'COURTESY_REVOKED'));

-- An auditable database transaction: if writing the audit record fails,
-- the grant/revocation rolls back too.
CREATE OR REPLACE FUNCTION public.study_owner_change_complimentary_premium(
  p_actor_user_id uuid,
  p_email text,
  p_confirm_email text,
  p_action text,
  p_days integer,
  p_reason text
)
RETURNS TABLE(customer_user_id uuid, customer_email text, complimentary_active boolean, ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_target uuid;
  v_email text;
  v_expiry timestamptz;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.study_support_roles r
    WHERE r.user_id = p_actor_user_id AND r.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'OWNER_REQUIRED';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) < 3 OR length(p_email) > 254
    OR p_confirm_email IS NULL
    OR lower(trim(p_email)) IS DISTINCT FROM lower(trim(p_confirm_email))
    OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 12 AND 280
    OR p_action NOT IN ('grant', 'revoke')
  THEN
    RAISE EXCEPTION 'INVALID_GRANT_REQUEST';
  END IF;

  SELECT u.id,u.email::text INTO v_target,v_email
  FROM auth.users u
  WHERE lower(u.email)=lower(trim(p_email))
  LIMIT 1;

  IF v_target IS NULL THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;

  IF p_action = 'grant' THEN
    IF p_days IS NULL OR p_days NOT IN (1,7,30) THEN
      RAISE EXCEPTION 'INVALID_GRANT_PERIOD';
    END IF;
    -- Do not overwrite an already-paid account's entitlement.
    IF EXISTS (
      SELECT 1 FROM public.study_live_subscriptions s
      WHERE s.user_id=v_target AND s.status='ACTIVE'
        AND s.verified_payment_id IS NOT NULL AND s.premium_expires_at > now()
    ) THEN
      RAISE EXCEPTION 'ALREADY_PAID_PREMIUM';
    END IF;
    v_expiry := now() + (p_days * interval '1 day');
    INSERT INTO public.study_complimentary_premium
      (user_id,granted_by,granted_at,expires_at,revoked_at,reason)
      VALUES(v_target,p_actor_user_id,now(),v_expiry,NULL,trim(p_reason))
    ON CONFLICT(user_id) DO UPDATE SET
      granted_by=EXCLUDED.granted_by, granted_at=EXCLUDED.granted_at,
      expires_at=EXCLUDED.expires_at, revoked_at=NULL, reason=EXCLUDED.reason;

    INSERT INTO public.study_support_audit
      (actor_user_id,target_user_id,action,reason)
      VALUES(p_actor_user_id,v_target,'COURTESY_GRANTED',trim(p_reason));
    RETURN QUERY SELECT v_target,v_email,true,v_expiry;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.study_complimentary_premium c
      WHERE c.user_id=v_target AND c.revoked_at IS NULL AND c.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'NO_ACTIVE_COURTESY_GRANT';
    END IF;
    UPDATE public.study_complimentary_premium c
      SET revoked_at=now()
      WHERE c.user_id=v_target AND c.revoked_at IS NULL;

    INSERT INTO public.study_support_audit
      (actor_user_id,target_user_id,action,reason)
      VALUES(p_actor_user_id,v_target,'COURTESY_REVOKED',trim(p_reason));
    RETURN QUERY SELECT v_target,v_email,false,NULL::timestamptz;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.study_owner_change_complimentary_premium(uuid,text,text,text,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.study_owner_change_complimentary_premium(uuid,text,text,text,integer,text)
  TO service_role;

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
