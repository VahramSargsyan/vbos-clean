# CRM-05A — TEST migration 0016, preservation-first release/rollback

## Exact scope / approval
Owner approved 2026-11-05: **manual owner-entered unit prices in AMD**, editable **internal Estimate draft**, **no automatic WorkOrder, VAT, discounts, client sending, finance, or accepted status**. This approval authorizes the bounded feature and TEST preparation, not deletion of unrelated Neon recovery branches, paid service or PROD.

- Repository: `VahramSargsyan/vbos-app`.
- Initial Clean TEST source: `64e8ac55ee265a9e8a36b0549a7fcccc1bf9873d`.
- Isolated feature source branch: `feature/vbos-clean-crm05a-manual-estimates-20261105`.
- TEST target only after source CI and fresh recovery gate: Neon `proud-hat-90291191` / `br-crimson-hat-b9kwg7n6` / `vbos_mvp_clean`; Render `srv-dbkvfh2jnfac73a31nv0` (workspace `tea-d1r9ktmmcj7s73am6c10`, autoDeploy disabled).
- Legacy Google, existing CRM IDs, Client/Object/Order ownership and Finance are out of scope.

## Data model / numeric policy
One draft per `source_lead_id`; stable Estimate UUID, revision, request key, and owner-only session. Four additive tables: `mvp_estimates`, `mvp_estimate_lines`, `mvp_estimate_versions`, `mvp_estimate_mutation_requests`; three indexes. Old tables untouched. `status=draft` only; no fake accepted status. At most 50 lines per Estimate. Quantities are exact PostgreSQL NUMERIC(9,3), >0 up to 100000; unit price must be explicitly entered as a whole number 0–1,000,000,000 AMD, or NULL when unpriced. 0 AMD is a deliberate price, not an unpriced shortcut. Labor and material subtotals are computed with BigInt thousandths of AMD in the application, no floating-point rounding; the internal display removes insignificant trailing zeros. No taxes, discounts or markup.

On edits, old line rows are **archived**, not deleted; stable `line_key` remains across versions. Exact immutable `mvp_estimate_versions.snapshot` per revision. Idempotency receipts commit with Estimate write atomically. A failed transaction must roll back archive, line inserts, revision and receipt together. The client cannot finalize/send an incomplete price total.

## Pre-release gate: do not waive
1. Reverify accepted Clean TEST branch exact SHA, PR candidate SHA, full disposable real PostgreSQL CI and all in-scope test results, Render autoDeploy OFF and current source.
2. Read all existing Clean TEST table schemas, counts and sorted row digests, including **both** `vbos_mvp_clean` and `vbos_mywork_test`; detect active owner data divergence.
3. **Fresh independently restorable backup of the current canonical TEST state including the user's real Lead, Plan items and CRM-04 notes.** Earlier branch `br-orange-field-b9htolnk` was created before CRM01 and before the user's real Lead; it does not count as fresh CRM-05A backup. Last read-only branch count 10/10; snapshots quota previously exhausted. Never delete an existing branch or snapshot on inferred permission. If new backup cannot be made at free capacity, **STOP** with concrete capacity blocker and request an exact owner-authorized cleanup, not a paid upgrade.
4. Rehearse exact SQL 0016 twice on a fresh disposable PostgreSQL CI, test all request/line/revision/permission/numeric invariants, include full prior Clean regression.
5. Inspect namespace collisions and current row integrity. Apply exact source SQL 0016 through official Neon transaction on **TEST only**. Read back four tables/indexes and compare every pre-existing row digest with the frozen backup. New tables should have 0 records immediately after migration.
6. Fast-forward only Clean TEST ref with expected-SHA lease. Deploy exactly that commit once using Render manual deploy, verify checkout SHA, startup transaction, LIVE status, and read-only data integrity postflight. Record receipt in PR. Do not merge to main or PROD.
7. Android owner acceptance: use existing real Lead to create an internal draft, save a WORK line and unpriced MATERIAL line, confirm incomplete total, add a price and confirm complete total, reload and edit. Never create a WorkOrder or alter Lead status.

## Rollback
**Before canonical SQL:** discard candidate; active Clean TEST unchanged.
**Before any real Estimate write, after SQL:** code rollback to accepted previous source `64e8ac55ee265a9e8a36b0549a7fcccc1bf9873d` via exact Render release, leave dormant additive tables until separately approved schema cleanup.
**After a real Estimate write:** no blind rollback of DB or DROP of Estimate tables; retain all real revisions and lines. The prior UI will not display them, so prefer a focused compatibility fix with CI. If exact code rollback is needed, warn owner Estimate edits are temporarily inaccessible; restore code without data loss.
**Recovery branch restore:** only after owner authorization to reconcile writes since snapshot, and a verified current backup. Do not restore a stale source to discard a genuine quote.
**NOT_RUN** until proven: independent destructive restore rehearsal, hosted Android acceptance, PROD. No manual files to copy.
