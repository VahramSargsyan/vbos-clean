# V9E WorkerTasks — safe TEST rollback

Scope: new Clean TEST schema only. **No DROP/TRUNCATE/DELETE of worker tasks, days, WorkLogs or Google history.** This is a forward-compatible additive migration; its data is durable even if code is rolled back.

1. Before applying `0009_worker_tasks.sql` to canonical Neon TEST, back up branch `br-crimson-hat-b9kwg7n6` with a new official Neon safety branch and record its parent LSN, original existing table counts, exact Git commit and SQL blob hash. First test on a new disposable branch with a separate compute.
2. Apply to **only** project `proud-hat-90291191`, DB `vbos_mvp_clean`, branch `br-crimson-hat-b9kwg7n6` after dedicated owner release approval and source/branch readback. Verify two tables and indexes, existing clients/objects/orders/workers/assignments/WorkLogs unchanged.
3. Deploy exact verified source commit to the Clean Render TEST service `srv-dbkvfh2jnfac73a31nv0`. Verify deployed commit, authenticated task start/finish and departure guard; obtain owner Android approval.
4. If regression occurs **before owner has created WorkerTasks**, stop writes, return **only the Clean TEST runtime code** to the immediately preceding exact Engineering P2 + business baseline `c33ea7dc734c291381d591aaa372bf3e258b3303` (Render `dep-dbll03gae00c73c7273g`) through an owner-approved, verified exact-source rollback; this preserves existing Engineering and CRM functionality; leave new empty tables in place.
5. If task rows or other new user data exist, **do not** restore the pre-release DB snapshot over them. Keep original rows and receipt provenance; investigate/repair with a scoped migration and independent approval. Previous code cannot interpret the new tasks but user records must remain intact.
6. A Neon backup branch is a recovery point only. Name swaps, restore over active branch or deletes are destructive and require separate explicit approval. No PROD, Finance, legacy Google migration or old WorkerTask ID remapping is included.

Release-specific source: current shared Clean TEST P2 commit `c33ea7dc734c291381d591aaa372bf3e258b3303`; canonical TEST Neon branch `br-crimson-hat-b9kwg7n6`. Official pre-0009 in-Neon backup `br-sparkling-star-b9sryfs5`, parent LSN `0/2A52918` (read-only recovery copy; not offsite backup). If snapshot policy or TEST shared head has drifted, stop and make fresh protected backup/readback before any schema write.

Status: ROLLBACK_PREPARED. Canonical Neon migration, Render V9E and Android owner acceptance are not authorized by this document and remain NOT_RUN.
