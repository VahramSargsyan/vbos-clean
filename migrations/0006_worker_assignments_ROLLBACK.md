# V9C staff/assignments — TEST migration and non-destructive rollback

**Scope:** source `devtools/vbos-mvp-clean/migrations/0006_worker_assignments.sql` applied only to isolated `proud-hat-90291191/vbos_mvp_clean` parent `br-crimson-hat-b9kwg7n6`. No legacy Google/PROD/finance/engineering schema changes.

1. Before applying: confirm exact CI PASS commit/Build Packet; read-only snapshot of live TEST counts (workers if any, manual/automatic schedules, orders, clients, objects, A1/visits/WorkLogs, legacy finance), existing tables absent. Recheck public exact source, Render branch, and no competing migration.
2. Rehearse the exact eight CREATE TABLE/INDEX commands twice with disposable PostgreSQL. New `mvp_workers`, `mvp_worker_order_assignments`, `mvp_manual_plan_workers`, `mvp_worker_requests`; 4 partial/covering indexes. No ALTER/DROP of existing schemas.
3. Apply through official guarded Neon prepare + readback and owner-approved complete; never bypass a tool safety block. After applying, all new tables have 0 rows and existing data counts unchanged. No historical workers imported automatically.
4. Deploy only exact green CI tested TEST commit, provider event and data readback. Never deploy incompatible runtime before migration.
5. **Safe code rollback:** redeploy previous V9B exact tested commit `e1d9fc20984d63893afe236c11db1b76bf58b331`, Render `dep-dble9o3m8hqs73920ghg`. Leave ALL worker records/assignment tables and user schedule data intact. Destructive DROP requires a separate approved, backed-up migration.
6. No automatic WorkerDays/worker payroll/qualification or historical IDs in this block. If business policy for assignments or existing schema differs, STOP and reconcile rather than guess.
