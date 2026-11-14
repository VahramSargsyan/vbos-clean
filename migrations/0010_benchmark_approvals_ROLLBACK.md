# V9H — safe TEST rollback
- **Application rollback:** restore exact V9F.2 runtime commit `409a873267eec1fa116c58c0c863caab488db605` / Render deployment `dep-dblnble1egvs73b474c0` if V9H TEST fails; do not overwrite an unrelated newer branch/runtime.
- **Database:** retain `mvp_benchmark_proposals`, `mvp_benchmark_approvals`, `mvp_benchmark_approval_events` and all saved decisions. The old app ignores these additive tables. Do not DROP tables or destroy manual approvals as automatic rollback.
- **Import:** V9H intentionally never overwrites existing proposals or approvals. Import a fresh verified source only via separately reviewed procedure and readback.
- **No PROD impact:** no legacy Google/Supabase mutation; no financial/worker rate propagation.
