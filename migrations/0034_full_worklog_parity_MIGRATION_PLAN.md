# VBOS Clean 0034 — FULL_WORKLOG_PARITY Migration Plan

## Authority and result
- Mode IMPLEMENT_FEATURE / risk L3 PostgreSQL schema and WorkLog writer. Owner Vahram; current assistant executor only. Budget 0, Codex OFF.
- Base installed TEST `b1dc701aed7701b04b7f6484ef6ef0207337d2fc`. Canonical TEST Neon project proud-hat-90291191 / branch br-crimson-hat-b9kwg7n6 / database vbos_mvp_clean. Render srv-dbkvfh2jnfac73a31nv0. No Google/PROD modification.
- Legacy source accepted main `Scripts.html` workLogFormHtml_ / openWorkLogModal_; `WorkLogService.js` buildWorkLogCanonicalFields_, requireOpenWorkDayForNewWorkLog_, saveWorkLogService_. Preserve old records and never infer missing legacy fields.
- New fields belong to 1:1 `public.mvp_work_log_details` by existing `mvp_work_logs.id`, rather than replacing a table or ID. New WorkLogs also retain the original basic columns. Existing records (including the current one) remain without a details row; user interface must label missing details as NOT_RECORDED, never as zero duration/loss/worker.
- `mvp_work_log_full_requests` stores idempotent revisioned full-work-log write receipts.

## Preflight
1. Verify exact GitHub candidate SHA, green CI real disposable PG tests and exact Render currently installed SHA; confirm Clean TEST isolated ownership.
2. Verify old data counts, IDs, relations and MD5 fingerprints for clients, objects, orders, work_logs, worker records, finance source.
3. Create a NEW dedicated Neon branch of canonical TEST and READ BACK counts and fingerprints. Existing branches and backups must not be deleted without separate explicit owner authorization. Neon full quota => BLOCKED_BACKUP_CAPACITY.
4. Verify table/indices absent. Migration 0034 must be run only against that target TEST branch/db, **not PROD**, after 2x disposable PG rehearsal and verified backup.
5. Read back tables, FKs/checks/index and original data MD5. No historical backfill and no default-inferred performer/timestamps.

## Install / release
- Apply exact SQL file `migrations/0034_full_worklog_parity_CANDIDATE.sql` as a single transaction. No DROP/ALTER of old rows.
- Exact-source fast-forward TEST branch `feature/vbos-mvp-clean-20261103` only if source lease unchanged; Render autoDeploy OFF, explicitly deploy exact candidate.
- Postflight same WorkLog fingerprints, owner-only auth, no duplicate replay, verified schema and runtime startup. Android owner acceptance: enter real job workday, choose order, record performer, date clocks, location, workType/units and optional metadata; verify one WorkLog saved, exact clean minutes and order/history projection, edited version and no side effects on finance/WorkerTasks.

## Rollback / guards
- On failure before migration: no changes. On migration error: PostgreSQL transaction ROLLBACK, backup untouched.
- After migration: redeploy exact previously accepted Render SHA. KEEP new tables and owner-entered detailed WorkLogs; never DROP or restore older full DB without owner approval/reconciling later data.
- Missing workday or worker day/assignment, bad time/overlap, ambiguous service, changed branch, 10/10 backup slots, failed CI, authentication or exhausted repairs => STOP.
- Non-goals: worker payroll, approved benchmarks, legacy Google writes, old historical WorkLog import, delete/archive of canonical records, mutation of existing WorkLog IDs, other TEST services.
