# FINANCE-MONTH-04 — one monthly additional-business-gains function, Clean TEST only

## Purpose, source and separation
- Port `BusinessGainService.js` normalization and per-month create/update semantics from original VBOS: `monthKey` literal YYYY-MM, five nonnegative categories, sum (two-decimal precision), optional notes <=2000 chars, one record per month, idempotent user request.
- Original Google remains financial authority; frozen stage `mvp_finance_stage.source_facts` contains 3 immutable `BUSINESS_MONTHLY_GAIN` records (2026-08, 2026-09, 2026-10). No copy/backfill of these original rows, no changes to source hash or archives, no connection to `FinanceTransactions`, `FinanceBalances` or `Capital`. New TEST entries must not be added to already-archived financial totals; the legacy archive is separately readable.
- TEST only: new `public.mvp_business_monthly_gains` and idempotency receipts `public.mvp_business_monthly_gain_requests`. Exactly one row per month; 5 checks on amounts, PostgreSQL GENERATED sum, revision for safe edit. Code strictly reads/writes only this TEST table and its receipts, never the legacy Google sources or live finance ledger.
- Implementation branch: `feature/clean-finance-order-result-v1-20261108`, Draft PR #1231, base `e962f8826246389ed7b3da7bf4daa9112a3c29a3`. Owner assigned single fourth finance function; no other implementation streams.

## Preflight and TEST migration gate
1. Technical CI must run `0026_finance_monthly_gains_TEST_ONLY.sql` **twice** in a disposable PostgreSQL 16 service and test actual create/update/idempotent replay, stale revision, amount bounds, owner gate and rollback. Source and transient DB test are not a hosted runtime test.
2. BEFORE any application to shared Neon TEST `proud-hat-90291191/br-crimson-hat-b9kwg7n6/vbos_mvp_clean`, verify environment ownership, exact source commit, no conflicting CRM schema changes, absence/presence and exact definition of the new tables, row fingerprints, and availability of a fresh independent backup. Neon branch quota must be checked; do not delete unrelated snapshots or proceed without backup.
3. Apply only the reviewed `0026` SQL as a bounded, transactionally checked TEST migration with short `lock_timeout` and `statement_timeout`. Read back primary key, column definitions, sum expression, CHECK constraints, immutable legacy row counts/hash, and new table counts=0. Existing real finance records stay unchanged.
4. Deploy exact verified source to existing authorized Clean TEST only under separate runtime release authorization. Verify owner authenticated form at / Finance: select month, enter five categories, see total, save; same request replay; edit with revision; wrong revision 409; old Google archive unchanged.

## Rollback
- If migration transaction fails: rollback transaction and read-back previous state. If code fails: redeploy exact pre-release Clean TEST commit; keep newly created tables (they contain no external authority and may later contain TEST records).
- Never automatically DROP new tables or restore whole database if user-created TEST records exist; get owner approval first. If not deployed/applied: simply close or revert Draft PR on feature branch; no DB rollback.
- STOP on unexpected table definitions, insufficient backup/Neon branch quota, incompatible shared changes, real-money authority ambiguity, or new PROD-related requests.
- **No main merge, no PROD, no paid API/Codex, no new Neon project or Render service.** Files to copy manually: none.
