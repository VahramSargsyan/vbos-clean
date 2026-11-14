-- CRM-15A legacy Client fields; additive, TEST only; no imported source rewrite.
ALTER TABLE public.mvp_clients
 ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '' CHECK(length(email)<=200),
 ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '' CHECK(length(address)<=500),
 ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','archived')),
 ADD COLUMN IF NOT EXISTS client_tier text NOT NULL DEFAULT '' CHECK(client_tier IN ('','regular','good','vip')),
 ADD COLUMN IF NOT EXISTS referral_status text NOT NULL DEFAULT '' CHECK(referral_status IN ('','none','one','active')),
 ADD COLUMN IF NOT EXISTS client_label_note text NOT NULL DEFAULT '' CHECK(length(client_label_note)<=5000);
-- Historical status of imported Clients remains authoritative in mvp_legacy_import_map.
