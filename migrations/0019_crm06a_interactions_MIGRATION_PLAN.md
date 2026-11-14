# CRM-06A MIGRATION_PLAN — TEST only

CAPABILITY_ID: VBOS_CLEAN_CRM06A_INTERACTIONS
BASE_COMMIT: 423653b09929a49e7b5f3f93e18e20cadaf57c75
OWNER_BRANCH: feature/vbos-clean-crm06-interactions-20261107
CANONICAL: existing public.mvp_leads and public.mvp_clients; new public.mvp_crm_interactions for new entries only.

## Scope
One append-only record for each owner-entered phone call, message, meeting, site visit, note or other contact, linked by an immutable Lead or Client foreign key. Optional next action and date are stored on the same interaction. No automatic scheduling, WorkOrder, Lead conversion, Finance mutation, historical data import or edits to CRM-04 notes.

## Before canonical TEST schema write
1. Verify exact migration file from passing CI with disposable real PostgreSQL; run SQL twice there.
2. Confirm owner TEST database vbos_mvp_clean in Neon project proud-hat-90291191 / branch br-crimson-hat-b9kwg7n6.
3. Obtain a fresh independently recoverable TEST backup **before** SQL, record its branch/snapshot ID, creation point, schema and table counts. Never delete another backup to make capacity.
4. Verify no concurrent conflicting schema/CRM mutation, deployment and latest approved source SHA.
5. Execute exact additive 0019 SQL once by an authorized Neon mechanism and run a read-only table/index/row-count check. No initial interaction rows; no existing row rewrites.

## Verification
Run CI package syntax, UI checks, and disposable real PostgreSQL auth/E2E, duplicate UUID and changed-payload conflict, target-FK/404, date, cursor, persistence and owner-only access. On canonical TEST, compare existing Lead/Client/CRM link counts before/after and verify one authenticated user scenario only when owner authorizes data write. Exact Render deployment must come from the verified feature SHA, not the existing Clean service branch HEAD.

## Rollback
Before any new interaction is created: revert application to the previous exact Clean TEST commit; if a fresh backup is verified and no subsequent legitimate data changed, an authorized restore may be considered. After owner contact history exists: **never DROP** public.mvp_crm_interactions or blindly restore the old snapshot. Re-deploy previous code only if compatible, retain the additive table and all persisted interactions; use an separately approved recovery plan for data corrections. No PROD/Google/Finance changes.

STOP: missing backup capacity, conflicting shared TEST owner, schema mismatch, required CI failure, source identity mismatch or material new business rule.
