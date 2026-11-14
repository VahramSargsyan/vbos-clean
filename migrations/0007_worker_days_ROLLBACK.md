# V9D WorkerDay — recovery and rollback

**TEST ONLY.** Additive migration `0007_worker_days.sql` creates `mvp_worker_days`, `mvp_worker_day_orders`, `mvp_worker_day_requests` and their indexes. No existing table is altered and no previous Worker/WorkOrder/Schedule/Finance IDs are converted.

Before applying to canonical Neon TEST: verify exact approved SQL blob, CI disposable PostgreSQL replay, current parent-row counts, and a retained point-in-time backup. **Apply only with explicit owner permission** using the approved Neon migration workflow, then verify parent counts and new FK/index invariants before exact-source Render TEST deployment.

To revert a failing release: redeploy previous exact V9C source `c682ce4a98cbc50c2d236ca7034d65fc78e73814` (Render deploy `dep-dblg0m8u01pc73a46280`). Keep additive V9D tables and saved employee-day records for audit/recovery. Do **not** run DROP/DELETE/ALTER in TEST or PROD as a code rollback. Never restore backup over newer owner-created data without a separate approved recovery procedure.

No legacy Google, Finance, Engineering, PROD or historical WorkerDays import occurs. A V9D shift is observational attendance only, not WorkerTask, WorkLog, payroll, financial payable, billable hours or timesheet payout. Date corrections that would alter order relations remain out of scope. 
