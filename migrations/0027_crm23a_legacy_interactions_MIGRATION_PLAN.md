> Integration note 2026-11-09: legacy TEST-only instructions below are historical. No live Neon, Render or main action is authorized. This file is an isolated CRM-23 candidate with migration number 0027 and later guarded release only.

# CRM-23A — TEST-only old Interactions archive / migration / rollback

## Read-only evidence, 2026-11-08

Old source: authorized native Google Sheet Working IP APP, exact Interactions tab. 30 source records: 12 calls, 3 notes, 5 final LeadClient relationship carriers, 10 pending LeadClient relationship carriers. Only 15 are genuine calls/notes; do not show the relationship carriers as conversations. All source IDs unique; original Lead references and timestamps valid. 4 genuine contacts have exactly one verified legacy Client identity through Clients.sourceLeadId or an exact final LeadClient relation. 11 old events have no final Client link (3 only pending); preserve their original Lead identity and do not assign them to a Client by name or phone.

Clean currently has 17 exact old Client mappings, zero old Lead mappings, 33 Lead source snapshots in an existing verified 131-row 8-entity batch, no old Interaction source records. Keep original frozen batch and native CRM19 interactions unchanged.

## Strict prerequisites before any Neon TEST write

1. Confirm exact branch, current TEST commit, completed full disposable PostgreSQL CI, Google source tab and stable row IDs/sha256. No source PII, user names, phones or notes may be committed in the repository or printed in technical receipts.
2. Fresh independent restorable Neon TEST backup/snapshot AFTER CRM22 release. Current free plan has 10/10 branches; do not delete another branch without separate owner consent. A Neon native snapshot is acceptable only after verifying provider support, restoration and zero incremental cost. Prior CRM22 backup is older and is not a fresh CRM23 recovery point.
3. Exact table fingerprints (15+ original tables, CRM22 transfer table, old 131 archive rows, Client source mappings) must match backup readback before writing. Any unexpected change stops the block.
4. Reconfirm the archived 8-entity manifest receipt; exactly 17 verified old Client ID mappings and 33 historic Lead source IDs; re-read Google source to avoid stale row counts.
5. Apply source-reviewed 0027_crm23a_legacy_interactions_CANDIDATE.sql in one guarded TEST-only SQL transaction, lock/statement timeout, never PROD.
6. Import exactly 30 original Interactions rows into private mvp_history.crm_legacy_interactions (15 activity, 5 final relation carriers, 10 pending relation carriers) preserving source_id, row_sha256, event timestamps, original Lead ID, notes and statuses. Create a single immutable verified import receipt with source snapshot SHA and exact counts, linked to the reconciled frozen 8-entity batch. No raw row payload in GitHub. Source import must be idempotent, fail on conflicting reused IDs, and roll back whole transaction if anything differs.
7. Readback 30/15/5/10 records; each old source Lead exists, old source IDs/hash match source sheet, zero ambiguous Client identities, 4 Client-linked genuine interactions, other 11 unassigned. Check all old table fingerprints unchanged and no new native Client/Lead/Interaction records.
8. Merge exact CI-passing source tree ONLY to Clean TEST, deploy exact SHA Render TEST, verify startup, unchanged data, and owner-only read. Android acceptance can be read-only; user does not want fake test leads.

## Rollback and limits

Prior exact Render TEST: dep-dbo9v3jm8hqs73fvd0sg / 5e51b51f3d9a85646c8d898b94f37cd28857117d. Roll back code only if necessary; preserve real archived historical rows. Full Neon restore from a fresh snapshot needs separate owner permission and review of writes after backup. Do not roll back to the pre-CRM22 backup. No PROD, no old Google writes, no automated Client linking by phone/name, no paid API.

**STOP if fresh independent zero-cost restorable backup unavailable.** In that case code can be CI tested and PR kept draft; do not run TEST SQL or deployment.

## 2026-11-09 guarded private importer implementation receipt

`crm-legacy-interactions-import.mjs` now defines `prepareLegacyInteractions` and `importPreparedLegacyInteractions`. The caller supplies original private `Interactions`, `Leads`, `Clients` and frozen IDs through a separately authorized connector operation at release time. Before any SQL: exact original headers, 30 records (15 activity, 5 final, 10 pending), unique source IDs, ISO timestamps, limits, frozen 33 Lead / 17 Client map consistency and an exact snapshot SHA256 are checked. The importer requires explicit owner release approval, independently restorable fresh backup and exact approved batch/modifiedTime/hash, then performs one transaction with immutable receipts, per-row SHA and conflict readback. Replays are no-ops; mismatches roll back. Candidate tested with synthetic PostgreSQL GitHub CI run `42676217406` on `39ea1016d1cb3d1b93951f8da28744c920ab4977` PASS. No actual Google rows imported, no working Neon SQL. 33 frozen Leads vs 32 current Leads is a documented safe subset difference; the frozen archive remains intact. The stored source data and receipt must be refreshed before separate owner-approved release.
