-- V9B: additive-only canonical automatic schedule mirror for standalone WorkOrders.
-- Independent of existing V9A manual records. TEST: proud-hat-90291191/vbos_mvp_clean.
CREATE TABLE IF NOT EXISTS public.mvp_schedule_order_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_kind text NOT NULL DEFAULT 'work_order' CHECK(source_kind='work_order'),
 auto_source_key text NOT NULL UNIQUE CHECK(length(auto_source_key) BETWEEN 12 AND 120),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','completed','cancelled','archived')),
 start_at timestamptz NOT NULL,
 end_at timestamptz NOT NULL,
 schedule_date date NOT NULL,
 object_id uuid NOT NULL REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL UNIQUE REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 item_type text NOT NULL DEFAULT 'Работа' CHECK(length(item_type) BETWEEN 1 AND 120),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_auto_plan_time_order CHECK(end_at>start_at),
 CONSTRAINT mvp_auto_plan_local_date CHECK((start_at AT TIME ZONE 'Asia/Yerevan')::date=schedule_date),
 CONSTRAINT mvp_auto_plan_source_key CHECK(auto_source_key='WORKORDER|'||order_id::text),
 CONSTRAINT mvp_auto_plan_archive_state CHECK((status='archived')=(archived_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mvp_auto_schedule_period_idx
 ON public.mvp_schedule_order_items(schedule_date,start_at,id) WHERE status<>'archived';
CREATE TABLE IF NOT EXISTS public.mvp_order_schedule_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('order_create','order_update','order_status')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
