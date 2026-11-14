-- VBOS Clean MVP V7 — object presence, isolated PostgreSQL TEST only.
-- Source: legacy WorkSessions v1.4.0.8; independent of work intervals and WorkLog.
-- Additive/idempotent; no existing schema changes, no old data import.
CREATE TABLE IF NOT EXISTS public.mvp_object_presence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 day_id uuid NOT NULL REFERENCES public.mvp_work_days(id) ON DELETE RESTRICT,
 day_date date NOT NULL,
 object_id uuid NOT NULL REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 order_id uuid REFERENCES public.mvp_orders(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 arrived_at timestamptz NOT NULL,
 departed_at timestamptz,
 arrival_recorded_at timestamptz NOT NULL DEFAULT now(),
 departure_recorded_at timestamptz,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_presence_departure CHECK(
 (status='open' AND departed_at IS NULL AND departure_recorded_at IS NULL) OR
 (status='closed' AND departed_at IS NOT NULL AND departure_recorded_at IS NOT NULL AND departed_at>=arrived_at)
 ),
 CONSTRAINT mvp_presence_arrival_date CHECK((arrived_at AT TIME ZONE 'Asia/Yerevan')::date=day_date),
 CONSTRAINT mvp_presence_departure_date CHECK(departed_at IS NULL OR (departed_at AT TIME ZONE 'Asia/Yerevan')::date=day_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_presence_one_open
 ON public.mvp_object_presence((status)) WHERE status='open';
CREATE INDEX IF NOT EXISTS mvp_presence_day_start
 ON public.mvp_object_presence(day_date DESC,arrived_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS public.mvp_presence_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('presence_start','presence_stop','presence_update')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
