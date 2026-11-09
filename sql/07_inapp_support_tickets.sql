-- Stage 7: in-app support tickets and message threads (no external email provider).
-- RUN THIS IN SUPABASE SQL EDITOR BEFORE MERGING PR. Does not touch PayPal.
-- Only the trusted Cloudflare service role can call the RPCs or read/write tables.
CREATE TABLE IF NOT EXISTS public.study_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 2 AND 80),
  contact_email text NOT NULL CHECK (length(contact_email) BETWEEN 3 AND 254),
  subject text NOT NULL DEFAULT 'Support request' CHECK (length(trim(subject)) BETWEEN 3 AND 120),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_sender text NOT NULL DEFAULT 'student' CHECK (last_message_sender IN ('student','owner','system')),
  student_last_read_at timestamptz NOT NULL DEFAULT now(),
  owner_last_read_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.study_support_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.study_support_tickets(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id),
  sender_role text NOT NULL CHECK (sender_role IN ('student','owner','system')),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_support_tickets_user_recent
  ON public.study_support_tickets (user_id,last_message_at DESC);
CREATE INDEX IF NOT EXISTS study_support_tickets_inbox_recent
  ON public.study_support_tickets (last_message_at DESC);
CREATE INDEX IF NOT EXISTS study_support_messages_ticket_order
  ON public.study_support_messages (ticket_id,id);
ALTER TABLE public.study_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_support_tickets FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.study_support_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_support_tickets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_support_messages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.study_support_messages_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.study_open_support_ticket(
  p_user_id uuid,p_name text,p_email text,p_subject text,p_message text
)
RETURNS TABLE(ticket_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE v_email text; v_id uuid;
BEGIN
  IF p_user_id IS NULL OR length(trim(coalesce(p_name,''))) NOT BETWEEN 2 AND 80
    OR length(trim(coalesce(p_subject,''))) NOT BETWEEN 3 AND 120
    OR length(trim(coalesce(p_message,''))) NOT BETWEEN 10 AND 4000
    OR length(coalesce(p_email,'')) NOT BETWEEN 3 AND 254 THEN
    RAISE EXCEPTION 'INVALID_TICKET_FIELDS';
  END IF;
  -- Serialize ticket creation for the same account to enforce limits concurrently.
  SELECT u.email::text INTO v_email FROM auth.users u
  WHERE u.id=p_user_id FOR UPDATE;
  IF v_email IS NULL OR lower(trim(p_email)) IS DISTINCT FROM lower(v_email) THEN
    RAISE EXCEPTION 'ACCOUNT_EMAIL_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM public.study_support_tickets t
      WHERE t.user_id=p_user_id AND t.created_at>now()-interval '1 day') >= 8
    OR (SELECT count(*) FROM public.study_support_tickets t
      WHERE t.user_id=p_user_id AND t.status!='resolved') >= 5 THEN
    RAISE EXCEPTION 'TOO_MANY_OPEN_TICKETS';
  END IF;
  INSERT INTO public.study_support_tickets (user_id,display_name,contact_email,subject)
    VALUES(p_user_id,trim(p_name),lower(trim(v_email)),trim(p_subject))
    RETURNING id INTO v_id;
  INSERT INTO public.study_support_messages (ticket_id,sender_user_id,sender_role,body)
    VALUES(v_id,p_user_id,'student',trim(p_message));
  RETURN QUERY SELECT v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.study_reply_support_ticket(
  p_actor_user_id uuid,p_ticket_id uuid,p_message text,p_as_owner boolean
)
RETURNS TABLE(message_id bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE v_ticket public.study_support_tickets%ROWTYPE; v_owner boolean; v_role text; v_id bigint;
BEGIN
  IF p_actor_user_id IS NULL OR p_ticket_id IS NULL OR
    length(trim(coalesce(p_message,''))) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'INVALID_MESSAGE';
  END IF;
  SELECT * INTO v_ticket FROM public.study_support_tickets
    WHERE id=p_ticket_id FOR UPDATE;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'TICKET_NOT_FOUND'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.study_support_roles r
    WHERE r.user_id=p_actor_user_id AND r.role='owner') INTO v_owner;
  IF coalesce(p_as_owner,false) THEN
    IF NOT v_owner THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
    v_role:='owner';
  ELSE
    IF v_ticket.user_id IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'TICKET_ACCESS_DENIED'; END IF;
    IF v_ticket.status='resolved' THEN RAISE EXCEPTION 'TICKET_RESOLVED'; END IF;
    v_role:='student';
  END IF;
  IF (SELECT count(*) FROM public.study_support_messages m
    WHERE m.sender_user_id=p_actor_user_id AND m.created_at>now()-interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'MESSAGE_RATE_LIMITED';
  END IF;
  INSERT INTO public.study_support_messages(ticket_id,sender_user_id,sender_role,body)
    VALUES(p_ticket_id,p_actor_user_id,v_role,trim(p_message)) RETURNING id INTO v_id;
  UPDATE public.study_support_tickets
    SET last_message_at=now(),updated_at=now(),last_message_sender=v_role,
      owner_last_read_at=CASE WHEN v_role='owner' THEN now() ELSE owner_last_read_at END,
      student_last_read_at=CASE WHEN v_role='student' THEN now() ELSE student_last_read_at END,
      status=CASE WHEN v_role='owner' AND status IN ('open','resolved') THEN 'in_progress' ELSE status END
    WHERE id=p_ticket_id;
  RETURN QUERY SELECT v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.study_change_support_ticket_status(
  p_actor_user_id uuid,p_ticket_id uuid,p_status text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE v_current text;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.study_support_roles r
    WHERE r.user_id=p_actor_user_id AND r.role='owner'
  ) THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('open','in_progress','resolved') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  SELECT status INTO v_current FROM public.study_support_tickets
    WHERE id=p_ticket_id FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'TICKET_NOT_FOUND'; END IF;
  IF v_current IS DISTINCT FROM p_status THEN
    UPDATE public.study_support_tickets
    SET status=p_status,updated_at=now(),last_message_at=now(),last_message_sender='owner',owner_last_read_at=now()
    WHERE id=p_ticket_id;
    INSERT INTO public.study_support_messages(ticket_id,sender_user_id,sender_role,body)
      VALUES(p_ticket_id,p_actor_user_id,'system','Ticket status updated to '||replace(p_status,'_',' ')||'.');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.study_mark_support_ticket_read(
  p_actor_user_id uuid,p_ticket_id uuid,p_as_owner boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth
AS $$
DECLARE v_owner boolean; v_user_id uuid;
BEGIN
  SELECT user_id INTO v_user_id FROM public.study_support_tickets WHERE id=p_ticket_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'TICKET_NOT_FOUND'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.study_support_roles r
    WHERE r.user_id=p_actor_user_id AND r.role='owner') INTO v_owner;
  IF coalesce(p_as_owner,false) THEN
    IF NOT v_owner THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
    UPDATE public.study_support_tickets SET owner_last_read_at=now() WHERE id=p_ticket_id;
  ELSE
    IF p_actor_user_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION 'TICKET_ACCESS_DENIED'; END IF;
    UPDATE public.study_support_tickets SET student_last_read_at=now() WHERE id=p_ticket_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.study_open_support_ticket(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.study_reply_support_ticket(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.study_change_support_ticket_status(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.study_mark_support_ticket_read(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.study_open_support_ticket(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.study_reply_support_ticket(uuid,uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.study_change_support_ticket_status(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.study_mark_support_ticket_read(uuid,uuid,boolean) TO service_role;
