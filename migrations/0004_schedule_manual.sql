-- V9A ScheduleItems manual planner. Target ONLY isolated Neon vbos_mvp_clean TEST.
-- Source semantics: accepted legacy ScheduleService.js. No WorkOrder auto-sync or worker assignment.
CREATE TABLE IF NOT EXISTS public.mvp_schedule_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_kind text NOT NULL DEFAULT 'manual' CHECK(source_kind='manual'),
 auto_source_key text NOT NULL DEFAULT '' CHECK(auto_source_key=''),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','completed','cancelled','archived')),
 start_at timestamptz NOT NULL,
 end_at timestamptz NOT NULL,
 schedule_date date NOT NULL,
 object_id uuid REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 order_id uuid REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 item_type text NOT NULL DEFAULT 'Работа' CHECK(length(item_type) BETWEEN 1 AND 120),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_schedule_time_order CHECK(end_at>start_at),
 CONSTRAINT mvp_schedule_local_date CHECK((start_at AT TIME ZONE 'Asia/Yerevan')::date=schedule_date),
 CONSTRAINT mvp_schedule_archive_state CHECK((status='archived')=(archived_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mvp_schedule_period_idx
 ON public.mvp_schedule_items(schedule_date,start_at,id) WHERE status<>'archived';
CREATE TABLE IF NOT EXISTS public.mvp_schedule_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('schedule_save','schedule_archive')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
