-- VBOS Clean V9E — standalone WorkerTasks in isolated TEST only.
-- Additive; never migrate legacy WorkerTask IDs/history or derive payroll/WorkLogs.
-- Must run after 0006 worker assignments and 0007 worker days.
CREATE TABLE IF NOT EXISTS public.mvp_worker_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 worker_day_id uuid NOT NULL REFERENCES public.mvp_worker_days(id) ON DELETE RESTRICT,
 worker_id uuid NOT NULL REFERENCES public.mvp_workers(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 object_id uuid NOT NULL REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 day_date date NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
 task_type text NOT NULL DEFAULT 'WORK_SESSION' CHECK(length(task_type) BETWEEN 1 AND 200),
 start_at text NOT NULL CHECK(start_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
 end_at text NOT NULL DEFAULT '',
 duration_minutes integer CHECK(duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
 result_qty numeric(14,3) CHECK(result_qty IS NULL OR result_qty>=0),
 result_unit text NOT NULL DEFAULT '' CHECK(length(result_unit)<=100),
 management_minutes integer NOT NULL DEFAULT 0 CHECK(management_minutes BETWEEN 0 AND 1440),
 outcome text NOT NULL DEFAULT '' CHECK(outcome IN ('','COMPLETED','PARTIAL','NOT_COMPLETED','WITH_ERROR')),
 problem boolean NOT NULL DEFAULT false,
 problem_type text NOT NULL DEFAULT '' CHECK(length(problem_type)<=500),
 rework boolean NOT NULL DEFAULT false,
 rework_minutes integer NOT NULL DEFAULT 0 CHECK(rework_minutes BETWEEN 0 AND 1440),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_worker_task_date_consistency CHECK(
  left(start_at,10)=day_date::text
  AND (end_at='' OR (end_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' AND left(end_at,10)=day_date::text))
 ),
 CONSTRAINT mvp_worker_task_completion_consistency CHECK(
  (status='active' AND end_at='' AND duration_minutes IS NULL AND outcome='' AND task_type='WORK_SESSION')
  OR (status IN ('completed','archived') AND end_at>start_at AND duration_minutes>0 AND outcome<>'' AND task_type<>'WORK_SESSION')
 ),
 CONSTRAINT mvp_worker_task_duration_bounds CHECK(
  (duration_minutes IS NULL OR management_minutes<=duration_minutes)
  AND (duration_minutes IS NULL OR rework_minutes<=duration_minutes)
 ),
 CONSTRAINT mvp_worker_task_result_unit CHECK(result_qty IS NULL OR result_qty=0 OR result_unit<>''),
 CONSTRAINT mvp_worker_task_problem CHECK(NOT problem OR problem_type<>'')
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_worker_tasks_one_active_worker ON public.mvp_worker_tasks(worker_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS mvp_worker_tasks_worker_day_idx ON public.mvp_worker_tasks(worker_day_id,start_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS mvp_worker_tasks_order_day_idx ON public.mvp_worker_tasks(order_id,day_date DESC,id DESC);
CREATE TABLE IF NOT EXISTS public.mvp_worker_task_requests (
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('worker_task_start','worker_task_finish')),
 payload_sha256 text NOT NULL CHECK(payload_sha256~'^[0-9a-f]{64}$'),
 response jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
