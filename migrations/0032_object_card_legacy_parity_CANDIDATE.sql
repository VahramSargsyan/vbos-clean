-- VBOS Clean OBJECT_CARD_LEGACY_PARITY_BATCH2 / additive CANDIDATE / NOT INSTALLED.
-- Restore legacy Object.objectType and append-only Object interaction history.
-- Independently idempotent on dedicated disposable/isolated TEST only.
ALTER TABLE public.mvp_objects
 ADD COLUMN IF NOT EXISTS object_type text NOT NULL DEFAULT ''
 CONSTRAINT mvp_objects_object_type_len CHECK (length(object_type)<=100);

CREATE TABLE IF NOT EXISTS public.mvp_object_interactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 object_id uuid NOT NULL REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 interaction_type text NOT NULL CHECK(interaction_type IN ('call','message','meeting','site_visit','note','other')),
 summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 1000),
 next_action text NOT NULL DEFAULT '' CHECK(length(next_action)<=500),
 -- Original VBOS accepted datetime-local; stored as Yerevan wall-clock (no UTC inference).
 next_action_at timestamp without time zone,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 status text NOT NULL DEFAULT 'active' CHECK(status='active'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(next_action_at IS NULL OR length(next_action)>0)
);
CREATE INDEX IF NOT EXISTS mvp_object_interactions_object_created_idx
 ON public.mvp_object_interactions(object_id,created_at DESC,id DESC);
-- No Google history import or implicit transfer of object records. Owner-only API.
