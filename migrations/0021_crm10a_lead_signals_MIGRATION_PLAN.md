# CRM-10A — SQL 0021 / TEST-only migration and recovery gate

Canonical shared TEST: Neon `proud-hat-90291191`, branch `br-crimson-hat-b9kwg7n6`, database `vbos_mvp_clean`. Clean Render `srv-dbkvfh2jnfac73a31nv0`, source `feature/vbos-mvp-clean-20261103` at pre-block commit `dd71a6e1721b891ccf157ef26e25aa1de269d07e`.

**SQL scope:** three additive `mvp_leads` columns, three field constraints and one request/receipt table. No backfill of unknown stage/source/need fields. Existing UUIDs, Lead status and revised reminder metadata remain canonical. Source includes accepted legacy stage/source keys but does not map existing Clean status to an `agreementStage`.

**STOP gate for release to shared TEST:** project currently uses all 10 Neon branch slots, including `br-quiet-night-b9etqr3j` (independent pre-CRM08 backup) and active Finance pilot `br-winter-king-b9ocl2ty`. These are preserved. A prior explicit owner authorization to delete the redundant V12 prebackup was specific to CRM08A and does NOT grant new general cleanup permissions. Do not delete branches/snapshots, spend money, apply SQL0021 to shared TEST or deploy source requiring new columns without a new safe backup/restore gate.

1. Revalidate exact CI SHA and source tree; Run SQL0021 twice on disposable real PostgreSQL CI (idempotent field guards).
2. Pre-release shared TEST: exact source metadata + counts/hashes for Leads/Clients/Calendar/CRM contacts and existing schema; independent fresh backup (new branch or separately accepted recoverable restorable snapshot) with branch LSN and 100% data+schema readback.
3. Apply exact committed SQL0021 once in one guarded transaction on canonical TEST; re-read constraints/columns/tables/empty receipts; compare original-row hashes ignoring new columns; no altered existing signal facts.
4. Merge exact TEST-only source, ensure identical git tree to tested source, manual Render exact deployment with receipt and postflight checks. Do not claim hosted real authenticated user tests if no authorized session.
5. **Code rollback:** previous exact Render `dd71a6e1721b891ccf157ef26e25aa1de269d07e`. Keep new signal fields and ledger; after genuine user writes, never restore older snapshot wholesale. **Data recovery:** only via verified independent pre-migration backup plus divergence reconciliation, explicit permission for destructive restore.

**Technical gates:** owner-auth 401/200, latest source snapshot, one Lead selection, strict enum/len, explicit fields editing, replay same UUID payload, 409 conflict and stale revision, terminal rejects, future score 0–100 parity, unknown stage returns NULL/unready, no score-write table or automatic history backfill, CRM01–09/Finance regression unchanged.

**NOT_RUN until independent backup:** shared Neon migration, exact CRM10A Render release, hosted authenticated/Android acceptance, destructive full restore. **FILES_TO_COPY:** none.
