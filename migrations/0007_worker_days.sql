-- VBOS Clean V9D additive migration candidate for isolated Neon TEST. Never run against PROD.
-- Worker attendance is separate from owner WorkDay, WorkLogs, task timers and finance.
CREATE TABLE IF NOT EXISTS public.mvp_worker_days(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 worker_id uuid NOT NULL REFERENCES public.mvp_workers(id) ON DELETE RESTRICT,
 day_date date NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','archived')),
 arrival_at text NOT NULL CHECK(arrival_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
 arrival_recorded_at timestamptz NOT NULL DEFAULT now(),
 departure_at text NOT NULL DEFAULT '',
 departure_recorded_at timestamptz,
 close_reason_code text NOT NULL DEFAULT '',
 close_reason_note text NOT NULL DEFAULT '' CHECK(length(close_reason_note)<=2000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_worker_day_local_date CHECK (
  left(arrival_at,10)=day_date::text
  AND (departure_at='' OR (departure_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' AND left(departure_at,10)=day_date::text))
 ),
 CONSTRAINT mvp_worker_day_end CHECK (
  (status='open' AND departure_at='' AND departure_recorded_at IS NULL)
  OR (status IN ('closed','archived') AND departure_at<>'' AND departure_at>=arrival_at AND close_reason_code<>'')
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_worker_days_one_active_date
 ON public.mvp_worker_days(worker_id,day_date) WHERE status<>'archived';
CREATE UNIQUE INDEX IF NOT EXISTS mvp_worker_days_one_open
 ON public.mvp_worker_days(worker_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS mvp_worker_days_date_id_idx
 ON public.mvp_worker_days(day_date DESC,id DESC);

CREATE TABLE IF NOT EXISTS public.mvp_worker_day_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 worker_day_id uuid NOT NULL REFERENCES public.mvp_worker_days(id) ON DELETE RESTRICT,
 work_order_id uuid NOT NULL REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 object_id uuid NOT NULL REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 linked_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(worker_day_id,work_order_id)
);
CREATE INDEX IF NOT EXISTS mvp_worker_day_orders_order_idx
 ON public.mvp_worker_day_orders(work_order_id,worker_day_id);

CREATE TABLE IF NOT EXISTS public.mvp_worker_day_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('worker_day_arrive','worker_day_depart','worker_day_correct')),
 payload_sha256 text NOT NULL CHECK(length(payload_sha256)=64),
 response jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
