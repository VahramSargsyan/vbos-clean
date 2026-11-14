-- VBOS Clean FULL WORKLOG legacy parity, migration 0034, TEST candidate.
-- Additive extension only. Existing mvp_work_logs UUIDs and rows stay untouched.
CREATE TABLE IF NOT EXISTS public.mvp_work_log_details (
 work_log_id uuid PRIMARY KEY REFERENCES public.mvp_work_logs(id) ON DELETE RESTRICT,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 work_day_id uuid NOT NULL REFERENCES public.mvp_work_days(id) ON DELETE RESTRICT,
 performer_mode text NOT NULL CHECK(performer_mode IN ('OWNER','WORKER','JOINT')),
 worker_id uuid REFERENCES public.mvp_workers(id) ON DELETE RESTRICT,
 start_clock time without time zone NOT NULL,
 end_clock time without time zone NOT NULL,
 location text NOT NULL CHECK(length(location) BETWEEN 1 AND 300),
 work_type text NOT NULL CHECK(length(work_type) BETWEEN 1 AND 180),
 work_detail text NOT NULL DEFAULT '' CHECK(length(work_detail)<=2000),
 service_id text NOT NULL DEFAULT '' CHECK(length(service_id)<=100),
 points numeric(14,2) CHECK(points>=0),
 nodes numeric(14,2) CHECK(nodes>=0),
 meters numeric(14,2) CHECK(meters>=0),
 complexity integer NOT NULL CHECK(complexity BETWEEN 1 AND 5),
 loss_minutes integer NOT NULL DEFAULT 0 CHECK(loss_minutes BETWEEN 0 AND 1439),
 loss_reason text NOT NULL DEFAULT '' CHECK(length(loss_reason)<=300),
 clean_minutes integer NOT NULL CHECK(clean_minutes BETWEEN 1 AND 1440),
 rework_status text NOT NULL DEFAULT 'no' CHECK(rework_status IN ('no','yes','disputed')),
 rework_reason text NOT NULL DEFAULT '' CHECK(length(rework_reason)<=300),
 rework_minutes integer NOT NULL DEFAULT 0 CHECK(rework_minutes BETWEEN 0 AND 1440),
 gap_reason text NOT NULL DEFAULT '' CHECK(gap_reason IN ('','lunch','materials','tool','chasing','waiting','call','helper','project','reschedule','coordination','travel','coffee','other')),
 comment text NOT NULL DEFAULT '' CHECK(length(comment)<=5000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(start_clock<end_clock),
 CHECK((performer_mode='OWNER' AND worker_id IS NULL) OR (performer_mode IN ('WORKER','JOINT') AND worker_id IS NOT NULL)),
 CHECK(loss_minutes<clean_minutes+loss_minutes),
 CHECK((loss_minutes=0 AND loss_reason='') OR (loss_minutes>0 AND length(loss_reason)>0)),
 CHECK((rework_status='no' AND rework_minutes=0 AND rework_reason='') OR (rework_status<>'no' AND length(rework_reason)>0))
);
CREATE INDEX IF NOT EXISTS mvp_work_log_details_day_start_idx
 ON public.mvp_work_log_details(work_day_id,start_clock,work_log_id);
CREATE TABLE IF NOT EXISTS public.mvp_work_log_full_requests (
 request_key uuid PRIMARY KEY,
 work_log_id uuid NOT NULL REFERENCES public.mvp_work_logs(id) ON DELETE RESTRICT,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 saved_revision integer NOT NULL CHECK(saved_revision>=1),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_work_log_full_requests_log_idx
 ON public.mvp_work_log_full_requests(work_log_id,created_at DESC);
