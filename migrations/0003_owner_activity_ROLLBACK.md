# V8 Owner Activity — TEST-only migration and safe rollback

Target: isolated Neon database `proud-hat-90291191 / vbos_mvp_clean`; do **not** run against old VBOS, PROD or Google Sheets.

1. Verify CI on disposable PostgreSQL by applying `0003_owner_activity.sql` twice. Test ownership, valid state, single timer, revisions, request replay, Asia/Yerevan midnight split, optional WorkDay / CRM relation, archive and backup.
2. Take read-only before-migration table/row count and schema receipt, especially owner settings, clients, objects, A1, work logs and object visits; never export credentials.
3. Execute only the four additive SQL `CREATE` statements in the versioned file, no existing table alterations. Check table constraints/indexes and initial empty new tables, preserved existing rows.
4. Only then release exact passing commit to existing Render TEST service. Verify Render SHA and PostgreSQL startup write/read/ROLLBACK plus new-table readback.
5. Code rollback: redeploy prior integrated TEST commit `951fe6ecdc1e9781480cf473793767a16303d3a7`, Render deployment `dep-dbl2k38u01pc73elbtl0`; **leave V8 tables and data intact**. Old code ignores the additive schema.
6. No DROP, DELETE, TRUNCATE or migration reversal without fresh explicit owner authorization and verified backup. Do not claim historical OwnerActivity migrated: all legacy records remain untouched.

Owner Android acceptance is postponed and is NOT_RUN. No main merge or PROD release.
