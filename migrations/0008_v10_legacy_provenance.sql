-- V10 Fast Start: additive compatibility for legacy source ID provenance.
-- PREPARATION ONLY. Do not apply to canonical Neon without approved migration gate.
-- Mirrors the existing canonical mvp_legacy_import_map structure; does not rewrite records.
CREATE TABLE IF NOT EXISTS public.mvp_legacy_import_map (
 source_system text NOT NULL,
 source_entity text NOT NULL,
 source_id text NOT NULL,
 target_id uuid NOT NULL,
 source_updated_at text NOT NULL DEFAULT '',
 source_payload jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (source_system,source_entity,source_id),
 UNIQUE (source_entity,target_id)
);
