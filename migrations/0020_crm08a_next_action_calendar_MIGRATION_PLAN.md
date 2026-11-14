# CRM-08A / SQL 0020 — TEST-only migration & rollback gate

## Scope and authority
- Existing Clean service: Render `srv-dbkvfh2jnfac73a31nv0`, source `feature/vbos-mvp-clean-20261103`, Neon `proud-hat-90291191`, `br-crimson-hat-b9kwg7n6`, `vbos_mvp_clean`.
- Candidate starts at exact Clean commit `2a42d61580c2224d607a55fcca0c007467634812`.
- Existing Lead IDs/statuses/revisions/Client relations and manual/order Calendar rows must be preserved. Only additive fields and new managed source table/receipt.
- No Google, Finance/Capital, legacy or PROD mutation. No unapproved cost, new service, branch deletion, or source repoint.

## STOP before canonical TEST migration
At 2026-11-07 preflight, Neon had **10/10 branches**, no spare independent backup slot; existing `br-fragrant-cloud-b992rmiw` predates CRM-08A but is **not** a fresh current-backup proof. This gate remains BLOCKED until capacity is available without violating preservation of existing branches, or a separately approved equivalent restorable independent backup is created and verified. Do not silently use an old snapshot as fresh. Never delete a backup merely to make room.

1. Recheck HEAD/PR/CI exact candidate, shared Clean branch ownership, main Neon parent and Render target. Do not merge/runtime deploy a blocked SQL candidate.
2. Take **fresh** independent Neon TEST branch/snapshot with known parent LSN; connect/read it, compare source schema, counts and Lead + Schedule + CRM footprints, and document a recovery route; test isolated restore without replacing live TEST if supported.
3. Apply **exact** committed `0020_crm08a_next_action_calendar_TEST_ONLY.sql` through supported Neon transactional mechanism. Run it twice in disposable CI first. Do not rewrite existing rows. If schema unexpectedly differs, STOP.
4. After apply verify new columns and tables/index/constraints, no changes to existing Lead/Clients/manual plan/order plan/Interaction rows, hashes, ID relations, source roles and effective grants. Confirm canonical current next-action text/date remain blank for preexisting Leads.
5. Integrate tested source with a verified lease and exact commit into Clean branch; verify git tree/source identity, Render commit checkout/logs, /health, hosted auth/read/save/reload/idempotency if owner session permits. Record receipt.
6. **Code rollback:** prior validated Render `dep-dbnmd5gu01pc73d5nqk0`, commit `2a42d61580c2224d607a55fcca0c007467634812`. A rollback may hide newly saved CRM next actions; preserve new columns and managed projection rows. Never DROP SQL 0020 or overwrite the TEST branch after new user writes without separate recovery plan.
7. **Data restore:** only from independently verified fresh backup after classifying all writes since snapshot. Blind restoration loses legitimate records. Restore rehearsal is a different operation from live restore.

## Tests
CI in disposable Postgres: strict 401, invalid clock, revision races, request-key replay/hash conflict, stable plan ID on rescheduling, clear/archive, archived→same-ID reuse, terminal lost/won atomic cleanup, unchanged manual/order plans, read-only CRM plan in calendar, no phantom contacts, export counts, transaction rollback via fault injection, no financial change. CI is not hosted mobile acceptance; label NOT_RUN honestly.
