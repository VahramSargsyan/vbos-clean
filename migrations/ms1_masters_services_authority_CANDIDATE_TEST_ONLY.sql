-- UNNUMBERED TEST-ONLY CANDIDATE. Not part of schema.sql or automatic migration.
-- Assign release number only after MS2/MS3 dependencies and owner acceptance.
-- Fresh scoped backup / exact TEST qualification / separate activation required.
-- No existing master, price, service, lead, provenance, UUID or relation is modified.
CREATE TABLE public.mvp_masters_services_authority (
 id integer PRIMARY KEY CHECK (id=1),
 phase text NOT NULL DEFAULT 'LEGACY' CHECK (phase IN ('LEGACY','CLEAN')),
 master_snapshot_hash text CHECK(master_snapshot_hash ~ '^[a-f0-9]{64}$'),
 dependency_receipt_hash text CHECK(dependency_receipt_hash ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (phase<>'CLEAN' OR (master_snapshot_hash IS NOT NULL AND dependency_receipt_hash IS NOT NULL))
);
INSERT INTO public.mvp_masters_services_authority(id,phase) VALUES(1,'LEGACY');
-- No CLEAN activation statement in this candidate.
-- Before business writes, rollback to previous exact runtime; drop candidate control
-- only after its users are removed and explicit rollback authorization.
