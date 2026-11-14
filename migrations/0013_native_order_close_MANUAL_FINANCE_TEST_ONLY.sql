-- VBOS Clean V13b.2 — additive native-only close, APPROVED Policy B.
-- For disposable PG CI only until fresh canonical TEST backup and release gate.
-- Never rewrite Legacy Google orders or declare financial settlement.
CREATE TABLE IF NOT EXISTS public.mvp_native_close_requests(
 request_key uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 action text NOT NULL DEFAULT 'close_work_order' CHECK(action='close_work_order'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_native_close_requests_order_idx ON public.mvp_native_close_requests(order_id);
CREATE TABLE IF NOT EXISTS public.mvp_native_client_assessments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE REFERENCES public.mvp_native_close_requests(request_key) ON DELETE RESTRICT,
 satisfaction text NOT NULL CHECK(satisfaction IN ('YES','PARTIAL','NO','UNKNOWN')),
 acceptance text NOT NULL CHECK(acceptance IN ('NO_REMARKS','MINOR_REMARKS','NOT_ACCEPTED_REWORK','UNKNOWN')),
 payment_behavior text NOT NULL CHECK(payment_behavior IN ('ON_TIME','DELAYED','PROBLEM','UNKNOWN')),
 communication_quality text NOT NULL CHECK(communication_quality IN ('EASY','NORMAL','DIFFICULT','CONFLICT','UNKNOWN')),
 scope_changes text NOT NULL CHECK(scope_changes IN ('NONE','FEW','MANY','UNKNOWN')),
 work_again text NOT NULL CHECK(work_again IN ('YES','YES_WITH_CONDITIONS','NO','UNKNOWN')),
 comment text NOT NULL DEFAULT '' CHECK(length(comment)<=5000),
 score integer CHECK(score BETWEEN 0 AND 100),
 score_version text NOT NULL CHECK(score_version='CLIENT_SCORE_V1_100'),
 known_factors integer NOT NULL CHECK(known_factors BETWEEN 0 AND 6),
 score_complete boolean NOT NULL,
 risk_label text NOT NULL CHECK(risk_label IN ('LOW_RISK','MEDIUM_RISK','HIGH_RISK','UNKNOWN')),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK((known_factors=0)=(score IS NULL)),
 CHECK(score_complete=(known_factors=6)),
 CHECK((NOT score_complete AND risk_label='UNKNOWN') OR score_complete)
);
CREATE TABLE IF NOT EXISTS public.mvp_native_order_close_facts(
 order_id uuid PRIMARY KEY REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE REFERENCES public.mvp_native_close_requests(request_key) ON DELETE RESTRICT,
 assessment_id uuid NOT NULL UNIQUE REFERENCES public.mvp_native_client_assessments(id) ON DELETE RESTRICT,
 previous_revision integer NOT NULL CHECK(previous_revision>=1),
 completion_date date NOT NULL,
 closed_at timestamptz NOT NULL DEFAULT now(),
 closed_by_login text NOT NULL CHECK(length(closed_by_login) BETWEEN 3 AND 48),
 finance_mode text NOT NULL CHECK(finance_mode='EXTERNAL_MANUAL'),
 finance_check_reference text NOT NULL CHECK(length(finance_check_reference) BETWEEN 8 AND 500),
 finance_checked_at timestamptz NOT NULL DEFAULT now(),
 payment_status text NOT NULL CHECK(payment_status='UNVERIFIED_IN_CLEAN'),
 unfinished_obligations_status text NOT NULL CHECK(unfinished_obligations_status='NONE'),
 close_note text NOT NULL DEFAULT '' CHECK(length(close_note)<=5000),
 removed_worker_assignments integer NOT NULL DEFAULT 0 CHECK(removed_worker_assignments>=0),
 archived_manual_plans integer NOT NULL DEFAULT 0 CHECK(archived_manual_plans>=0),
 completed_auto_plans integer NOT NULL DEFAULT 0 CHECK(completed_auto_plans>=0),
 source_system text NOT NULL CHECK(source_system='CLEAN_NATIVE')
);
-- Immutable historical evidence cannot be changed through an ordinary update or delete.
CREATE OR REPLACE FUNCTION public.mvp_native_close_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 RAISE EXCEPTION 'MVP_NATIVE_CLOSE_FACTS_IMMUTABLE' USING ERRCODE='55000';
END $body$;
CREATE OR REPLACE FUNCTION public.mvp_native_close_source_guard()
RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE o_status text;
BEGIN
 SELECT status INTO o_status FROM public.mvp_orders WHERE id=NEW.order_id;
 IF o_status IS NULL OR o_status NOT IN ('open','active') THEN
  RAISE EXCEPTION 'MVP_NATIVE_CLOSE_ORDER_NOT_ACTIVE' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mvp_native_client_assessments
  WHERE id=NEW.assessment_id AND order_id=NEW.order_id AND request_key=NEW.request_key) THEN
  RAISE EXCEPTION 'MVP_CLOSE_ASSESSMENT_ORDER_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.mvp_legacy_import_map
  WHERE target_id=NEW.order_id AND source_entity='WorkOrders') THEN
  RAISE EXCEPTION 'MVP_GOOGLE_ORDER_CLOSE_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $body$;
CREATE OR REPLACE FUNCTION public.mvp_native_order_terminal_guard()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 IF OLD.status='done' AND NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION 'MVP_NATIVE_CLOSED_ORDER_TERMINAL' USING ERRCODE='23514';
 END IF;
 IF NEW.status='done' AND OLD.status IS DISTINCT FROM NEW.status
  AND (NOT EXISTS(SELECT 1 FROM public.mvp_native_order_close_facts WHERE order_id=NEW.id)
       OR EXISTS(SELECT 1 FROM public.mvp_legacy_import_map
          WHERE target_id=NEW.id AND source_entity='WorkOrders')) THEN
  RAISE EXCEPTION 'MVP_CLOSE_PROTOCOL_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $body$;
CREATE OR REPLACE FUNCTION public.mvp_native_closed_order_activity_guard()
RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE blocked boolean := false;
BEGIN
 IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='mvp_worker_tasks' THEN blocked := NEW.status='active';
 ELSIF TG_TABLE_NAME='mvp_sessions' THEN blocked := NEW.ended_at IS NULL;
 ELSIF TG_TABLE_NAME='mvp_worker_order_assignments' THEN blocked := NEW.status='active';
 ELSIF TG_TABLE_NAME IN ('mvp_schedule_items','mvp_schedule_order_items') THEN
  blocked := NEW.status='planned';
 END IF;
 IF blocked AND EXISTS(SELECT 1 FROM public.mvp_orders
  WHERE id=NEW.order_id AND status='done') THEN
  RAISE EXCEPTION 'MVP_CLOSED_ORDER_CANNOT_ADD_ACTIVE_WORK' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $body$;
DO $triggers$
DECLARE t text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.mvp_native_client_assessments'::regclass AND tgname='mvp_native_assessment_immutable') THEN
  CREATE TRIGGER mvp_native_assessment_immutable BEFORE UPDATE OR DELETE
   ON public.mvp_native_client_assessments FOR EACH ROW EXECUTE FUNCTION public.mvp_native_close_immutable_guard();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.mvp_native_order_close_facts'::regclass AND tgname='mvp_native_close_fact_immutable') THEN
  CREATE TRIGGER mvp_native_close_fact_immutable BEFORE UPDATE OR DELETE
   ON public.mvp_native_order_close_facts FOR EACH ROW EXECUTE FUNCTION public.mvp_native_close_immutable_guard();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.mvp_native_order_close_facts'::regclass AND tgname='mvp_native_close_source_gate') THEN
  CREATE TRIGGER mvp_native_close_source_gate BEFORE INSERT
   ON public.mvp_native_order_close_facts FOR EACH ROW EXECUTE FUNCTION public.mvp_native_close_source_guard();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.mvp_orders'::regclass AND tgname='mvp_native_order_done_gate') THEN
  CREATE TRIGGER mvp_native_order_done_gate BEFORE UPDATE OF status
   ON public.mvp_orders FOR EACH ROW EXECUTE FUNCTION public.mvp_native_order_terminal_guard();
 END IF;
 FOREACH t IN ARRAY ARRAY['mvp_worker_tasks','mvp_sessions','mvp_worker_order_assignments','mvp_schedule_items','mvp_schedule_order_items'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||t)::regclass AND tgname='mvp_native_closed_active_guard') THEN
   EXECUTE format('CREATE TRIGGER mvp_native_closed_active_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mvp_native_closed_order_activity_guard()',t);
  END IF;
 END LOOP;
END $triggers$;
ALTER TABLE public.mvp_native_close_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_native_client_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_native_order_close_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mvp_native_close_requests,
 public.mvp_native_client_assessments,public.mvp_native_order_close_facts FROM PUBLIC;
-- Server DB owner only; no anonymous/authenticated direct access or payment authority.
