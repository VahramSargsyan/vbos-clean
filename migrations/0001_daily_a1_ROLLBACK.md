# V6 A1 — safe rollback and migration receipt

**Target:** isolated Neon `proud-hat-90291191 / vbos_mvp_clean` ONLY. Do not run in legacy PROD or any Google database.

1. Source backup/readback before migration: confirm `mvp_settings`, `mvp_leads`, `mvp_clients`, `mvp_objects`, `mvp_orders`, `mvp_work_days`, `mvp_sessions`, `mvp_work_logs`, `mvp_legacy_finance_report` unchanged. A1 tables should not exist before first execution. Do not copy or log password hashes.
2. Rehearse exact `0001_daily_a1.sql` on disposable PostgreSQL with full E2E, including repeat execution and request-key conflict tests.
3. Apply only the two `CREATE TABLE IF NOT EXISTS` statements from the versioned SQL file to the isolated existing TEST database. No row update, table replacement, index rebuild or source data import.
4. Read back `information_schema.columns` / `pg_constraint` and exact empty A1 row/request counts. Deploy exact CI-verified git SHA to existing Render TEST, then check startup real PostgreSQL transaction probe.
5. **Code-only rollback (non-destructive):** redeploy V5 exact commit `215d5f4562bdbaa4d5415f2d0df4403a7c4f63bd` / Render deploy `dep-dbl1pl6k1f9s73e9d760`. Leave additive A1 tables intact so data created in TEST is not lost and can be resumed.
6. **Destructive schema teardown is NOT authorized by this block.** If separately approved in future, first export A1 rows and receipts, verify table ownership, request explicit authorization, and only then use a rehearsed guarded DROP plan. Never drop tables merely to roll back code.
