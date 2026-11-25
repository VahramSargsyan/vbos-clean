-- 0039 scoped read-only fingerprint. Run separately on exact target and independent restored copy.
-- Compare result privately; do not commit receipt hash or source rows. Never substitute for a restorable backup.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SELECT encode(sha256(convert_to(jsonb_build_array(
 (SELECT jsonb_build_array('mvp_crm_masters',count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) FROM public.mvp_crm_masters t),
 (SELECT jsonb_build_array('mvp_service_reference_batches',count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) FROM public.mvp_service_reference_batches t),
 (SELECT jsonb_build_array('mvp_services_reference',count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) FROM public.mvp_services_reference t),
 (SELECT jsonb_build_array('mvp_master_prices_reference',count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) FROM public.mvp_master_prices_reference t),
 (SELECT jsonb_build_array('mvp_crm_lead_transfers',count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) FROM public.mvp_crm_lead_transfers t),
 (SELECT jsonb_build_array('mvp_work_log_details',count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) FROM public.mvp_work_log_details t)
)::text,'UTF8')),'hex') AS scope_sha256;
COMMIT;
