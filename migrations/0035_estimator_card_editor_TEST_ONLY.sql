-- EST-CARDS-01 / VBOS Clean. Additive PostgreSQL TEST migration; no existing rows modified.
-- Immutable source system codes (WC, ...); USER card IDs are native UUIDs prefixed USR:.
CREATE TABLE IF NOT EXISTS public.mvp_estimator_cards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 card_key text NOT NULL UNIQUE,
 source_type text NOT NULL CHECK(source_type IN ('SYSTEM','USER')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
 category text NOT NULL DEFAULT 'OTHER' CHECK(category ~ '^[A-Z0-9_-]{2,40}$'),
 unit text NOT NULL DEFAULT 'шт' CHECK(length(trim(unit)) BETWEEN 1 AND 30),
 supports_water boolean NOT NULL DEFAULT false,
 supports_sewer boolean NOT NULL DEFAULT false,
 supports_install boolean NOT NULL DEFAULT true,
 water_points smallint NOT NULL DEFAULT 0 CHECK(water_points BETWEEN 0 AND 30),
 sewer_points smallint NOT NULL DEFAULT 0 CHECK(sewer_points BETWEEN 0 AND 30),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 recipe_mode text NOT NULL DEFAULT 'SOURCE' CHECK(recipe_mode IN ('SOURCE','OWNER_OVERRIDE')),
 materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(materials)='array' AND jsonb_array_length(materials)<=100),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT estimator_card_key_contract CHECK(
  (source_type='SYSTEM' AND card_key IN ('WC','WASH','SH','SH+','BATH','JAC','KIT','WM','BAXI','INSTALL','WMETER','I-HG'))
  OR (source_type='USER' AND card_key ~ '^USR:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 ),
 CONSTRAINT estimator_card_action_contract CHECK(
  status='archived' OR (supports_water OR supports_sewer OR supports_install)
 ),
 CONSTRAINT estimator_card_points_contract CHECK(
  (NOT supports_water OR water_points>0) AND (NOT supports_sewer OR sewer_points>0)
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_estimator_cards_active_name_idx
 ON public.mvp_estimator_cards(category,lower(display_name)) WHERE status='active';
CREATE TABLE IF NOT EXISTS public.mvp_estimator_card_requests (
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('estimator_card_save','estimator_card_archive','estimator_card_reset')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- No public grants. All endpoints behind existing authenticated owner gate.
