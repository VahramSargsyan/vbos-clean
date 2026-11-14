# V7 object presence — migration and rollback plan

Only the isolated Neon `proud-hat-90291191 / vbos_mvp_clean` database is in scope. The legacy PROD source and Sheets are never modified.

1. Verify exact GitHub candidate and its PostgreSQL E2E CI has passed; run migration `0002_object_presence.sql` twice on disposable PostgreSQL and check constraints.
2. Take read-only table/schema inventory on TEST, including existing 17 clients and 18 objects, settings/owner, A1, operational and legacy finance tables. Keep the count receipt; do not export password hashes.
3. Apply exact `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements from the versioned migration to `vbos_mvp_clean` only. No existing-table ALTER/UPDATE/DELETE.
4. Verify presence and requests tables empty, expected columns/indexes/constraints and original row counts unchanged. Deploy exact successful candidate on the existing Render TEST service. Recheck exact SHA and runtime PostgreSQL startup.
5. Safe rollback: redeploy V6 `25fa232e68a2af91567cafe1ad3142d9ffaf8d73` (deployment `dep-dbl23bei0phs73bjpr0g`) **without dropping presence tables or deleting any records**. Code rollback does not reverse existing business data.
6. Destructive teardown (DROP) is not authorized. If separately approved later, back up any presence visits/receipts, rehearse guarded teardown on a copy and secure explicit owner permission.
