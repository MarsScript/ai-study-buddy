-- Stage 5: private, read-only customer-support authorization (manual setup required).
-- Run in the project's Supabase SQL Editor before deploying Stage 5 endpoints.
-- Does NOT grant any account admin access automatically, accept payments,
-- impersonate customers, or allow manual Premium activation.
CREATE TABLE IF NOT EXISTS public.study_support_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','support')),
  granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.study_support_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_support_roles FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_support_roles TO service_role;

CREATE TABLE IF NOT EXISTS public.study_support_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  target_user_id uuid REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('CUSTOMER_LOOKUP')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 8 AND 280),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_support_audit_recent ON public.study_support_audit(created_at DESC);
ALTER TABLE public.study_support_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_support_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT ON public.study_support_audit TO service_role;

-- The service role can search customer identity without exposing auth.users
-- to the public or to ordinary logged-in students.
CREATE OR REPLACE FUNCTION public.study_support_find_customer(p_email text)
RETURNS TABLE(user_id uuid, email text, registered_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT u.id, u.email::text, u.created_at
  FROM auth.users u
  WHERE length(p_email) BETWEEN 3 AND 254
    AND lower(u.email) = lower(trim(p_email))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.study_support_find_customer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.study_support_find_customer(text) TO service_role;
