# FINANCE_NATIVE_POSTING_PILOT_V1 — isolation, migration and rollback

Scope: only the dedicated Neon child branch finance-native-synthetic-pilot-v1-20261106 / database vbos_finance_pilot_20261106 and disposable PostgreSQL CI (database vbos_mvp_ci). The shared Clean TEST PostgreSQL main branch, original Google Finance/Capital, PROD and historical source archive must not be written.

## Migration plan
1. Verify the branch is a dedicated child, never Neon main; verify a separately named *pilot* database and no real financial clients/users.
2. The additive script native-pilot-isolated.sql creates only schema finance_pilot and its own fixture tables, audit and idempotency receipts.
3. Source records in public/history/finance and the 24+18+38 preserved controls must be completely unaffected.
4. Run only synthetic entity IDs, artificial amounts and isolated Postgres transactions. No original-to-Clean ID bridge is applied.
5. For CI, the PostgreSQL service is a newly created disposable runner database. No permanent migration or customer rollback is required.

## Rollback and recovery
- Before any hosted integration: stop using the pilot module, discard its feature branch/PR; the shared Clean runtime has never imported it.
- Runner PostgreSQL is destroyed with the CI job. Do not apply destructive cleanup to any persistent Neon branch through automated test code.
- Do not delete the dedicated Neon branch, snapshots or backups automatically. Explicit owner authorization and a branch identity check are required before deleting the pilot database or branch.
- If only the isolated pilot database schema was changed, rollback may be scheduled separately as deletion of that isolated database after verifying the exact child branch/DB IDs. This is NOT permission to drop a similarly named schema on shared Clean or PROD.
- If a test fails halfway, the adapter rolls back the whole PostgreSQL transaction; receipt, canonical transaction, fund movements and audit must all remain unchanged.
- Clean finance authority stays Google. No dual writer, no opening-balance adjustment, no historical operation import as money movement.

## Remaining release gates
- Reconcile all legacy source Finance/Capital IDs and client/order/object/worker links before any real native posting.
- Define exact single financial writer, backup, historical replay/checkpoint and cutover date; owner decision required.
- Run owner-authenticated hosted TEST, repeat/idempotency, direct persisted database readback and Android usability tests; exact tested commit plus deployment receipt required.
- Never equate this synthetic pilot with a live financial writer or PROD release.

TEST_LEVEL until CI/readback: NOT_RUN. FILES_TO_COPY: none.


## B8 migration/rollback amendment (2026-11-10)
B8 uses only disposable `vbos_mvp_ci` PostgreSQL with synthetic IDs and a synthetic linked owner investment. It adds native fund cumulative counters and a separate `finance_pilot.allocation_batches` relation. This CREATE script is for fresh disposable databases only: an existing pilot installation needs a separately audited ALTER + backup, not silent CREATE IF NOT EXISTS. No shared Neon schema, historical Google sheet, installed Clean runtime or finance authority is changed. Atomic rollback on failure covers Finance, FINCAP, fund lines, counters, receipts and audit; discard the B8 Draft branch to roll back source. Linked allocation reversals remain blocked.
