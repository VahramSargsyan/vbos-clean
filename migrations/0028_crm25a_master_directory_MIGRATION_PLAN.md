# CRM-25A Master directory — candidate migration, not an authorized rollout

**STATUS: PREPARED ONLY.** SQL `0028_crm25a_master_directory_CANDIDATE.sql`. 0027 is reserved for CRM23 and may be renumbered during coordinated integration. No live SQL/Render/PROD operations permitted by this task.

## Preflight before an owner-authorized release

1. Confirm exact accepted source SHA and current Render/Neon target; inspect authoritative migrations already applied, conflicts and schema. Confirm `mvp_crm_lead_transfers` exists from SQL0025. Confirm no conflicting `mvp_crm_masters` or unrelated Masters authority. Unresolved conflict = STOP.
2. Create **fresh independently restorable** live Clean PostgreSQL backup and verify independent restore capability, record backup ID and source/database receipt. Never delete a different environment branch/snapshot without owner approval.
3. Check existing live row counts and hashes for Leads/Clients/Transfers; inspect source legacy `Masters` tab through authorized read-only Google connector, capture modifiedTime, exact header, source ID hash, row count. 2026-11-09 baseline: 5 rows; treat as observed, not immutable.
4. Run `0028` only through official guarded transaction at planned approved release, no destructive schema change. Double-replay in isolated disposable PostgreSQL must pass before acceptance.

## Historical import (separate guarded approved operation)

- Source columns in exact original Google order: `masterId,createdAt,updatedAt,status,name,phone,email,serviceArea,notes,clientRequestId,qualityTier,messengerType,messengerContact`. Keep exact `source_master_id`; assign independent UUID. Native Clean `master_id` is not legacy textual ID.
- Import all unique source IDs only, use parameterized inserts with `source_system=LEGACY_GOOGLE`, `source_master_id` and correct enumerations/status; record immutable source-version manifest and counts. Do not generate import fixture with real names/phones/email/notes in GitHub. Do not merge by display name/phone. Pause on duplicate/unknown status/version, stale source receipt, unexpected row count, or missing fresh backup.
- Preserve original Google sheet unchanged. Decide authority cutover and conflict handling before changing imported records from the Clean UI; imported rows are read-only in Clean until that separate explicit owner decision.
- Validate all source IDs mapped uniquely and exact count, all 5 fields data lengths/status enums, no source lost, no broken foreign keys; confirmed current unique source ID count may differ from last read.

## Postflight

Verify unchanged original Clients/Leads/Transfers; only additive `master_id` nullable, all existing CRM22 manual recipients preserve NULL; check auth, idempotent create, update, archive, master transfer, readback; exact Render candidate separately after approval. No auto-release.

## Rollback

Prior exact working Render commit remains the code fallback. Additive SQL can remain for backward compatibility without deleting real data. Never drop `mvp_crm_masters` or NULL-out master IDs once user writes exist. Database restoration requires explicit owner approval, original backup receipt and reconciliation of newer writes. If import fails before commit, rollback its transaction. If post-commit problems occur, STOP and prepare a scoped reconciliation proposal.

**CURRENT TASK:** feature branch implementation only, no migrations executed on live Neon or legacy Google Sheets. Codex/paid API disabled.

## 2026-11-09 guarded historical Masters importer amendment

`crm-legacy-masters-import.mjs` now defines `prepareLegacyMasters` and `importPreparedLegacyMasters` for the five original `Masters` rows. SQL0028 is still a CANDIDATE, now includes immutable `mvp_history.crm_legacy_master_receipts`, source date text, original client request key, source row SHA256 and a provenance receipt reference in `mvp_crm_masters`. Preserve original `source_master_id` without interpreting it as a native UUID. All legacy records are read-only; native workers are never remapped to Masters. Import demands separate user consent, fresh independently restorable backup, matching source modifiedTime/batch/hash, a transaction, exact receipt + row collision readback and row-count=5. CI synthetic PostgreSQL import/idempotence/conflict rollback PASS on run `42676217406` at `39ea1016d1cb3d1b93951f8da28744c920ab4977`. Real Google Masters not imported and working Neon remains unchanged. Owner must decide the later legacy master write-authority cutover before any historical rows are edited in Clean. Existing frozen backup branch `br-solitary-rain-b9r7fp1p` is not a proven restore rehearsal.
