-- VBOS clean-start MVP (2026-11-03). New separate Neon database only.
-- No historical CRM/WorkLogs data imported. No legacy source mutation.
CREATE TABLE IF NOT EXISTS public.mvp_leads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),contact_name text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'new'
 CHECK(status IN ('new','contacted','qualified','won','lost')),notes text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_clients(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),phone text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_objects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 client_id uuid NOT NULL REFERENCES public.mvp_clients(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),address text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 object_id uuid NOT NULL REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 lead_id uuid REFERENCES public.mvp_leads(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','active','done','cancelled')),
 planned_on date,notes text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_work_days(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),day_date date NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 opened_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.mvp_sessions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 day_id uuid NOT NULL REFERENCES public.mvp_work_days(id) ON DELETE RESTRICT,
 order_id uuid REFERENCES public.mvp_orders(id) ON DELETE SET NULL,
 description text NOT NULL DEFAULT '',started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_one_open_session
 ON public.mvp_sessions((ended_at IS NULL)) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS public.mvp_work_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 day_date date NOT NULL,order_id uuid REFERENCES public.mvp_orders(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440),quantity numeric(14,3),
 unit text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_legacy_finance_report(
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),label text NOT NULL,
 source_date date NOT NULL,report jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_settings(
 setting_key text PRIMARY KEY,setting_value text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_orders_status_idx ON public.mvp_orders(status,created_at DESC);
CREATE INDEX IF NOT EXISTS mvp_worklogs_date_idx ON public.mvp_work_logs(day_date DESC);
CREATE INDEX IF NOT EXISTS mvp_sessions_day_idx ON public.mvp_sessions(day_id,started_at DESC);
