# V9A ScheduleItems — TEST-only migration and rollback

Target: `proud-hat-90291191/vbos_mvp_clean` only. Legacy Google Sheets/PROD, other Neon databases and main are out of scope.

1. Rehearse exact `0004_schedule_manual.sql` twice in disposable PostgreSQL real authenticated HTTP E2E, including status, FK/link, date/clock, pagination, archiving and failure atomicity.
2. Read-only inventory in Neon: existing settings/clients/objects/orders/workdays/WorkLog/A1/visits/business-time and finance snapshot row counts plus check new schedule tables absent. Do not export owner password hashes.
3. Apply only the exact three additive `CREATE TABLE/INDEX IF NOT EXISTS` statements from migration; do not ALTER, UPDATE, DELETE, DROP or truncate existing tables. Read back schema/constraints/indexes; initial schedule/receipt rows must be 0; existing rows preserved.
4. Deploy only the exact GitHub integrated TEST commit with complete PASS CI and check matching Render service/branch and startup PostgreSQL transactional probe. Owner Android acceptance remains NOT_RUN by prior instruction.
5. **Safe code rollback:** redeploy pre-V9A TEST exact `c03aba331d4b91c3bd9c158d4c9ce2a986abf66a` / `dep-dbl3ev67bikc7389bo9g` (or update to last independent tested PRE_V9A SHA receipt if concurrent branch advanced). Leave additive schedule tables and any real user plans intact. Code rollback must not revert stored plans.
6. Destructive schema teardown is **NOT** authorized. For future DROP, obtain explicit owner permission and backup user rows, rehearse on copy.
7. Full legacy ScheduleItems import and auto WorkOrder sync require separate lineage and migration contract; no historical records imported in this block.
