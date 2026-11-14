-- EST-PRICES-01: additive native owner Estimate pricebook, TEST only. No existing rows changed.
CREATE TABLE IF NOT EXISTS public.mvp_estimator_tariff_profiles (
 tariff_code text PRIMARY KEY CHECK(tariff_code IN ('ECONOM','STANDARD_PLUS','VIP')),
 multiplier numeric(8,4) NOT NULL CHECK(multiplier>0 AND multiplier<=20),
 rounding_step integer NOT NULL CHECK(rounding_step BETWEEN 1 AND 100000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_estimator_price_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_type text NOT NULL CHECK(scope_type IN ('GLOBAL_ACTION','CARD_ACTION')),
 action_type text NOT NULL CHECK(action_type IN ('WATER','SEWER','CHASING','FIXTURE_INSTALL')),
 card_key text NOT NULL DEFAULT '',
 economy_base_amd numeric(13,0) CHECK(economy_base_amd BETWEEN 0 AND 1000000000),
 standard_floor_amd numeric(13,0) CHECK(standard_floor_amd BETWEEN 0 AND 1000000000),
 vip_floor_amd numeric(13,0) CHECK(vip_floor_amd BETWEEN 0 AND 1000000000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT estimator_price_scope_contract CHECK(
  (scope_type='GLOBAL_ACTION' AND action_type IN ('WATER','SEWER','CHASING') AND card_key='')
  OR (scope_type='CARD_ACTION' AND action_type='FIXTURE_INSTALL' AND length(card_key) BETWEEN 1 AND 64)
 ),
 CONSTRAINT estimator_price_floor_base_contract CHECK(
  economy_base_amd IS NOT NULL OR
  (standard_floor_amd IS NULL AND vip_floor_amd IS NULL)
 ),
 UNIQUE(scope_type,action_type,card_key)
);
CREATE TABLE IF NOT EXISTS public.mvp_estimator_price_requests (
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('estimator_tariff_save','estimator_price_save')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Not a finance posting. No global service wage/stock authority, no GRANT to PUBLIC.
