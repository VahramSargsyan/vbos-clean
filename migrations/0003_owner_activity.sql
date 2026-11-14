-- V8 OWNER ACTIVITY, isolated PostgreSQL TEST database vbos_mvp_clean ONLY.
-- Existing mvp_* tables and legacy Google/PROD are not modified. Idempotent additive schema.
CREATE TABLE IF NOT EXISTS public.mvp_owner_activities(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 day_date date NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
 activity_class text NOT NULL CHECK(activity_class IN ('ORGANIZATION','BUSINESS_SYSTEM')),
 summary text NOT NULL DEFAULT '' CHECK(length(summary)<=1000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 start_at timestamptz NOT NULL,
 end_at timestamptz,
 duration_minutes integer,
 work_day_id uuid REFERENCES public.mvp_work_days(id) ON DELETE SET NULL,
 related_entity_type text NOT NULL DEFAULT '' CHECK(related_entity_type IN ('','Lead','Client','Object','WorkOrder')),
 related_entity_id uuid,
 parent_activity_id uuid REFERENCES public.mvp_owner_activities(id) ON DELETE RESTRICT,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 started_recorded_at timestamptz NOT NULL DEFAULT now(),
 ended_recorded_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_owner_activity_relation_pair CHECK((related_entity_type='')=(related_entity_id IS NULL)),
 CONSTRAINT mvp_owner_activity_start_date CHECK((start_at AT TIME ZONE 'Asia/Yerevan')::date=day_date),
 CONSTRAINT mvp_owner_activity_completed_state CHECK(
  (status='active' AND end_at IS NULL AND duration_minutes IS NULL AND ended_recorded_at IS NULL) OR
  (status IN ('completed','archived') AND end_at IS NOT NULL AND end_at>start_at AND duration_minutes>0 AND ended_recorded_at IS NOT NULL)
 ),
 CONSTRAINT mvp_owner_activity_end_boundary CHECK(
  end_at IS NULL OR (end_at AT TIME ZONE 'Asia/Yerevan')::date=day_date
  OR (end_at AT TIME ZONE 'Asia/Yerevan')::timestamp=((day_date+1)::timestamp)
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_owner_activity_one_active
 ON public.mvp_owner_activities((status)) WHERE status='active';
CREATE INDEX IF NOT EXISTS mvp_owner_activity_date_idx
 ON public.mvp_owner_activities(day_date DESC,start_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS public.mvp_owner_activity_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('owner_activity_start','owner_activity_stop','owner_activity_update','owner_activity_archive')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
