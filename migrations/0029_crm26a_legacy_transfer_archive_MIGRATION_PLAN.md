# CRM-26A — migration plan: Google LeadTransfers to immutable Clean historical archive

**STATUS: CANDIDATE_ONLY; no authorized live import, Neon DDL, main merge, Render release or legacy Sheet write.** File: `0029_crm26a_legacy_transfer_archive_CANDIDATE.sql`. SQL numbers 0027 (CRM23) and 0028 (CRM25) are reserved; reconcile against exact accepted schema during a separately authorized four-feature integration.

## Source discovery, 2026-11-09, READ ONLY

- Canonical historical source: legacy Google VBOS `Working IP APP` sheet `LeadTransfers`; original Columns exactly `transferId,createdAt,updatedAt,status,leadId,recipientName,reason,transferredAt,comment,clientRequestId,masterId`.
- Old `Leads` exact source header through `lastTransferId, lastTransferredAt, lastTransferRecipient, lastTransferReason`, original sources in `Config.js` and `CrmService.js transferLeadService_`.
- Read-only snapshot: 2 unique old transfers, 32 old Leads, both transfer statuses active, reasons `no_time` and `different_specialist_needed`, both Master source IDs present, both transfer/Lead links match `Leads.lastTransferId` and Lead status transferred. **0 source Lead IDs match current Clean UUIDs**. Source Drive modifiedTime on the observed copy: `2026-11-08T10:59:32.797Z`. These are observations, not frozen data for later release. No names, phone numbers, comments, source IDs or contact details committed here.
- New Clean canonical transfer `public.mvp_crm_lead_transfers` is a different live writer with immutable UUID `lead_id`, unique by live Lead. Do not coerce old text IDs to native UUIDs or change native Lead status. Similarly don't map legacy `masterId` by name; CRM25 stores independent native UUIDs and optional exact `source_master_id`.

## Controlled implementation

- `mvp_history.crm_legacy_lead_transfer_batches` records source snapshot SHA256, source modifiedTime, exact sheet and row count.
- `mvp_history.crm_legacy_lead_transfers` is **additive immutable archive**, primary key original `transferId` (text). Original Lead/Master IDs remain text with **NO native Lead/Master foreign keys**; reason, status, timestamp text, recipient, comment and original request ID remain preserved, with row hash and batch ID.
- `crm-legacy-transfers-import.mjs` consumes private connector-exported exact source arrays and explicit external receipt, validates headers, unique IDs, source Lead linkage/status/lastTransfer ID, supported enums, exact row count and SHA256. Any mismatch fails closed *before SQL*.
- Import execution requires a dedicated owner approval, independently **restorable backup receipt**, exact approved batch ID+source digest, source freshness check and an authorized executor/runner. No owner-data importer is invoked as part of this branch's CI.
- Prepared import: single PostgreSQL transaction with immutable `ON CONFLICT DO NOTHING` and *exact row SHA, source lead, batch and total count readback*. Any different row under the same source transfer ID rolls back. No delete/overwrite/merge or sync to Google.
- User-facing GET `/api/crm/legacy-transfers` is owner-authenticated and keyset-paginated, search by source ID/recipient; separate read-only CRM archive view, escaped PII and explicit statement that original Lead IDs are not linked to native Leads.

## Release procedure (only after separate permission)

1. Freeze final four-function candidate CRM23/24/25/26 on exact accepted Clean head; inspect migrations 0027–0029 conflicts and all touched shared `app.js`, `server.mjs`, `e2e.mjs`, package scripts.
2. Create independently restorable **fresh Neon backup** and test restoration/receipt with actual verified constraints; do not destroy other snapshots/branches.
3. Re-read Google metadata and exact `LeadTransfers`/`Leads` bounded ranges, compare unique ID and count, SHA, checks for duplicates and source relations; preserve sensitive rows only in the authorized private importer transaction. Capture verified source modifiedTime and batch manifest. Never publish original row values in PR/CI logs.
4. Rehearse exact SQL twice and safe importer with synthetic data on disposable PostgreSQL (part of CRM26 CI); later apply accepted exact migration to actual approved DB via official guarded path, then execute separately approved actual source import. Check 2/2 or changed verified count, 0 collisions, status and timestamps, 0 native mutations, source snapshot receipt. If any mismatch: **STOP** before deployment.
5. Deploy only exact tested commit with explicit user approval after suitable backup and readback; owner acceptance via normal work usage, not routine dummy data creation.

## Reversal

- Before release: discard branch; no live data migration.
- If import fails inside transaction: rollback leaves database unchanged.
- If code requires rollback after an approved release: restore exact last working application commit, leave additive historical archive inert and untouched; do not drop/erase archived business data automatically.
- Any whole-DB restore requires user approval and reconciliation of newer legitimate user writes. No direct Google Sheets structure mutation.

**TEST LEVEL:** candidate source/static/unit, isolated real PostgreSQL synthetic migration replay/import/readback and owner authenticated HTTP; Android/app runtime NOT_RUN until separately approved release. **CAPABILITY_ID:** VBOS_CLEAN_CRM26_LEGACY_TRANSFERS_ARCHIVE. **OWNER:** CRM-26 feature branch. **API/CODEX:** 0/not approved.
