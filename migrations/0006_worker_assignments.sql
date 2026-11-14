-- VBOS Clean V9C: standalone staff + explicit assignments, isolated TEST database only.
-- Legacy Workers and Pay/QualificationHistory are NOT imported or touched.
CREATE TABLE IF NOT EXISTS public.mvp_workers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=60),
 phone_key text NOT NULL DEFAULT '' CHECK(length(phone_key)<=60),
 role_title text NOT NULL DEFAULT '' CHECK(length(role_title)<=160),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_workers_phone_key_uniq
 ON public.mvp_workers(phone_key) WHERE phone_key<>'';
CREATE INDEX IF NOT EXISTS mvp_workers_status_name_idx
 ON public.mvp_workers(status,name,id);
CREATE TABLE IF NOT EXISTS public.mvp_worker_order_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 worker_id uuid NOT NULL REFERENCES public.mvp_workers(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed','archived')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(worker_id,order_id),
 CONSTRAINT mvp_worker_order_removed_at CHECK ((status='active')=(removed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS mvp_worker_order_by_order_idx
 ON public.mvp_worker_order_assignments(order_id,worker_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS public.mvp_manual_plan_workers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL UNIQUE REFERENCES public.mvp_schedule_items(id) ON DELETE RESTRICT,
 worker_id uuid NOT NULL REFERENCES public.mvp_workers(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_manual_plan_removed_at CHECK ((status='active')=(removed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS mvp_manual_plan_worker_idx
 ON public.mvp_manual_plan_workers(worker_id,plan_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS public.mvp_worker_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('worker_create','worker_update','worker_assign_order','worker_remove_order')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
