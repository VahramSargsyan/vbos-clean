# VBOS Clean — V10 Fast Start / guarded CRM import preparation

Date: **2026-11-04** (Asia/Yerevan). Status: **REAL_SOURCE_RECONCILED / ISOLATED_NEON_REHEARSAL_PASS / CANONICAL_IMPORT_NOT_AUTHORIZED**.

This is a **checkpoint/Build Packet extension**, not a competing product specification. It supplements Clean MVP PR #1162 / V9D PR #1174 and Finance/History preparation PR #1168. The user authorized safe preparation, exact legacy↔Clean identity checks, an isolated temporary database, QA and rollback planning. The user **explicitly prohibited canonical Neon TEST and Render changes until separate approval**. No PROD/Google mutations, legacy cuts, finance transfers, Codex jobs, paid APIs, main merges or Render deployments are authorized.

## 1. Contract and exact boundaries

- CAPABILITY_ID: `VBOS_CLEAN_V10_FAST_START`. Workflow: `IMPLEMENT_FEATURE / MIGRATION_PREPARATION` (no operational promotion). Risk: **L3** (historical identity, foreign keys, status semantics, current operational activity).
- Exact accepted working Clean integration starting commit: `5a2151527854077b266f2d0e7113df6675bc85bb` on `feature/vbos-mvp-clean-20261103`. Prior V9D TEST deploy: `dep-dblh5ngae00c73c87k3g`, URL https://vbos-clean-mvp-2026.onrender.com/ .
- Source of truth for current business facts: protected Google workbook **Working IP APP**, read-only. One extra owner-confirmed genuine three-record Shadow-only Lead→Object→WorkOrder chain is preserved using a private owner-only evidence workbook, not fabricated. Historical accepted Shadow SQL fresh readback remains an independent gate.
- Canonical Clean database (DO_NOT_TOUCH): Neon project `proud-hat-90291191`, DB `vbos_mvp_clean`, branch `br-crimson-hat-b9kwg7n6`. Render service `srv-dbkvfh2jnfac73a31nv0` (DO_NOT_TOUCH).
- **Only temporary write target:** disposable branch `br-fragrant-mountain-b9t4e7fg`, created from parent LSN `0/2914308` and READY. Nothing in the live Google source or main Neon project branch was written.
- Owner-private identity evidence remains a restricted Google Sheet; DO NOT publish its file ID, raw legacy IDs, exact UUID pairs, names, phone numbers, source JSON or credentials in GitHub. Stored access was independently verified `shared=false` with owner-only permission.

## 2. Fresh source and 35-entry identity proof

Google workbook metadata `modifiedTime=2026-11-03T19:06:09.263Z` remained unchanged before/after bounded reads. Bounded source reads returned exactly: **17 Clients, 18 Objects, 32 Leads, 21 WorkOrders, 2 Workers, 1 WorkerWorkOrderAssignment (removed), 24 FinanceTransactions**. Among 21 orders: **13 completed, 4 archived, 2 planned, 2 active**. No source relation errors: orders' clients/objects/leads and parent client links, worker assignment worker/order/object and financial operation WorkOrder links all resolve (0 missing across checked categories).

Private IDENTITY_MAP: **17 client + 18 object pairs**, source/target unique, no missing source/target, zero wrong parent mappings. Read-only actual field comparison with canonical Neon: **0 client name, 0 phone, 0 object title, 0 object address, 0 parent mismatches**. Independently recomputed all **35/35 SHA-256 hashes** from the nine defined core map fields using a UTF-8 pure implementation whose empty/abc/quick-fox test vectors passed. The owner previously accepted the **business equivalence** of all 17+18 entities (including one phone-free client and eight address-free objects), **NOT each private mapping row for final execution**. Row-level `EXACT_PAIR_REVIEW_PENDING` remains in the private file; no signoff was invented. Control manifest SHA is an existing reported anchor, not newly signed in this block.

Owner-confirmed Shadow chain private evidence: **one Lead (won), one Object (draft), one WorkOrder (active)**; all three full JSON rows and hash fields present. All three legacy source IDs are disjoint from Google namespaced IDs in their corresponding checked categories. The order points to its Shadow object and Shadow lead and shares the object's existing mapped legacy client. The Shadow object's `source_lead_id` is **NULL in the stored original**; do not fabricate that relationship. Owner confirmed this chain as genuine. **Fresh official accepted Shadow SQL/source-hash attestation: NOT_RUN/BLOCKED** from earlier shadow connection timeout; a private cached snapshot is not a substitute for an authorized fresh read.

## 3. Actual separate Neon PostgreSQL rehearsal

The disposable branch inherited **27 public tables**, 17 existing clients, 18 existing objects and one manual plan, preserving the same protected settings and existing archive report. Rehearsal created only in that disposable branch:
- `v10_faststart.source_rows` with original complete JSON and source status/hashes: **27 staged rows** (21 Google orders + 2 Google workers + 1 removed Google assignment + 3 private Shadow-chain records). Temp schema and tables revoked PUBLIC grants. This is ephemeral private TEST evidence, not a production-approved security model.
- `v10_faststart.legacy_id_map`: **44 entries** after trial (35 existing client/object pairs; 4 Google active/planned WorkOrders; 2 Google Workers; 3 Shadow-only entries). Source and target identity kept separate. The 35 existing pairs remain `EXACT_PAIR_REVIEW_PENDING` and new entries `PENDING_APPROVAL` or `SHADOW_CHECKPOINT_REVERIFY_REQUIRED`.

**Candidate operational projection written only to temporary Neon:**

| Table / projection | Canonical Neon | Disposable rehearsal |
|---|---:|---:|
| Clients | 17 | 17 |
| Objects | 18 | 19 (1 genuinely extra Shadow object) |
| Leads | 0 | 1 (Shadow-only lead) |
| WorkOrders | 0 | 5 (4 Google live + 1 Shadow live) |
| Workers | 0 | 2 |
| Active worker-order assignments | 0 | 0 (the one old assignment is removed) |
| Auto ScheduleItems | 0 | 1 (source Shadow dated order) |
| Manual ScheduleItems | 1 | 1 |
| WorkerDays and WorkLogs | 0 | 0 |

Five operational candidate orders: 3 `active`, 2 `open`; the two Google `planned` statuses are mapped to the Clean `open` placeholder **only in the rehearsal**, with original `planned` held in immutable source evidence. All four Google active/planned orders have blank `plannedStartDate`; **do not invent dates or automatic plans**. Shadow dated order received one 09:00–10:00 Asia/Yerevan V9B auto ScheduleItem. The 13 completed and 4 archived old Google orders **are not returned to active operation**; their 17 full original rows remain staged in the disposable database and remain authoritative in protected Google. Full user-visible History port is a separate scope. The removed worker assignment was not reactivated.

The Clean operational schema does not expose legacy object status `draft` and does not carry all 23 historic WorkOrder fields, source lead references, worker salary/qualification or finance facts. Original fields stay in source evidence. No false WorkLog, payroll or accounting data was created. Real work in the Clean app must not be represented as synchronized with Google before an explicit writer policy is adopted.

## 4. PostgreSQL QA with actual copied private data

**PASS**
1. All 4 Google operational WorkOrders joined uniquely to mapped existing Clean object UUIDs; both Workers passed name/phone-key/role/notes validation, all 3 Shadow records passed shape/identity validation.
2. Resulting 5 WorkOrders and 19 objects had **0 broken FK parent references**. All 5 WorkOrders and 2 Workers joined to explicit legacy source IDs in the disposable ID map.
3. Exactly 17 old completed/archived orders remained nonoperational; their original statuses persisted in staged JSON; Google and Shadow staged status/JSON comparisons returned 0 mismatches.
4. Exact replay of the import selection for 2 Workers, 4 Google orders and 1 Shadow order inserted **0 duplicates**; auto-plan replay also inserted **0 duplicates**. **Important limit:** these query-level conflict rules must still be replaced by a guarded, source-hash-validated transactional production import runner; unchanged duplicate suppression alone is insufficient against changed source payloads.
5. Foreign-key negative-test on a nonexistent object rejected the inserted Order; no orphan persisted.
6. Temporary real Worker assignment → WorkerDay arrival → WorkerDay-order relation committed only inside a deliberately thrown nested exception; rollback/negative readback showed **0 leaked assignment/WorkerDay/WorkerDayOrder**.
7. Found a concrete rehearsal omission: imported dated WorkOrder initially had no V9B auto ScheduleItem. Focused repair added exact period/source_key/local-time mirror to disposable Neon. Date/time/status/title/object parity **1/1 PASS**, existing manual ScheduleItem **1/1 preserved**.
8. **27/27 parent public-table row-count baseline preserved**, with exactly 5 expected differences confined to disposable copies of `mvp_leads`, `mvp_objects`, `mvp_orders`, `mvp_workers`, `mvp_schedule_order_items`. Other 22 public tables have unchanged counts.
9. Deep content fingerprints of the preexisting 17 clients, original 18 objects, settings, the original manual calendar plan, and the archive finance report matched main Neon byte-content-derived database digests **5/5**. No original target ID was rewritten.
10. Post-rehearsal readback: **main Neon untouched** (17 clients, 18 objects, 0 leads, 0 orders, 0 workers, 0 auto plans, 1 manual plan); Render remains V9D exact live commit `5a2151527854077b266f2d0e7113df6675bc85bb`; Google `modifiedTime` unchanged; private map owner-only.

**NOT_RUN / NOT APPROVED**: real canonical TEST import; signed exact 35-row private pair approval; fresh official Shadow canonical SQL/hash revalidation; a reviewed application-level import runner with transaction/idempotency changed-source refusal, locked writer policy, and security owner audit; protected authenticated browser flow against imported rows (Render deliberately not connected to temporary branch); full history page; finance payment/capital parity; owner physical Android acceptance; PROD release. GitHub CI passing for V9D is not a V10 deployment test.

## 5. Gate and rollback for the next separately authorized block

**Stop before touching canonical Neon or Render.** Required workflow:
1. Freeze fresh old Google business snapshot and current Shadow evidence at an agreed cutoff; re-read old source and compare IDs/row semantic hashes twice. Confirm no independent owner edits in Clean since rehearsal. Source drift invalidates the import manifest rather than silently updating it.
2. Have the owner approve the **exact protected 35 client/object ID pairs** (not just entity-count equivalence). Shadow only proceeds when its canonical source is freshly verified or an explicitly approved evidence alternative is recorded. If still blocked, a safe **Google-only 4-Order + 2-Worker partial Fast Start** can be a *separate owner choice*, holding Shadow chain intact for later — never deleting it.
3. Owner explicitly decides two observable business rules: **(a)** whether to show legacy `planned` as Clean `open` with original status preserved separately and without an invented date, and **(b)** whether imported orders may be edited in Clean while old Google remains source of truth (no silent two-writer conflict). The Shadow object's original `draft` must also remain in provenance because Clean has no corresponding status.
4. Develop/review a versioned exact import runner and `MIGRATION_PLAN` using **one PostgreSQL transaction** for order, auto-schedule, receipt and ID-map writes; strict source snapshot and hash match, unique legacy ID mapping, changed-source abort, idempotent unchanged replay, FK/role policy, protected original statuses and full rollback dry-run. SQL statements issued ad hoc during this ephemeral test are **NOT** a signed canonical migration package.
5. Create a **new** full pre-import backup/PIT Neon branch after snapshot freeze. Apply only with another explicit owner approval to branch `br-crimson-hat-b9kwg7n6`, DB `vbos_mvp_clean`. Verify old 17/18 identities and 27-table invariants and added 4+2(+Shadow 1+1+1) counts/relations; do not write to legacy Google.
6. Only after that release an **exact reviewed SHA** on Render Clean TEST; check startup, public health, auth, order lookup, worker assignment, schedule V9B and real owner workflows. Owner UX acceptance is independent. Do not merge to `main` or release PROD by implication.
7. **Rollback before canonical import:** leave current V9D untouched; discard only disposable temp branch and/or this isolated documentation PR. **Rollback after any separately authorized import:** first stop writes; preserve new user changes/receipts; use reviewed exact backup/PIT and per-row inverse only after identity and downstream-reference checks. Never blindly restore over newer owner records or truncate source tables. Runtime code rollback target remains V9D commit `5a2151527854077b266f2d0e7113df6675bc85bb` / Render deploy `dep-dblh5ngae00c73c87k3g`; code rollback alone does not undo imported data.

## 6. Release readiness and checkpoint

**REHEARSAL_PASS / CANONICAL_RELEASE_GATE_BLOCKED**. Five candidate live orders and two workers can coexist in isolated PostgreSQL with referential and schedule parity; the original 17 historical orders, one removed assignment and original statuses were not silently reactivated. Exact private mapping signoff, Shadow freshness, business status/writer decisions and a signed transactional import runner are unresolved. A successful copied-data rehearsal must **not** be relabeled as user-accepted, canonical database migration, full historical migration or PROD.

No files need manual copying. No canonical Neon TEST migration, Render deployment, original Google write or additional paid/third-party executor was performed. The disposable Neon branch is retained with sensitive temporary staged data only for bounded technical verification; it must be deleted when no longer needed under the next explicit cleanup/release procedure. This may consume normal Neon resources; no cost/quota balance has been verified.

<!-- HI_V1 {"date":"2026-11-04","SESSION_ID":"vbos-clean-v10-fast-start-preparation-20261104","REVISION":1,"NUDGE":0,"NEXT":0,"QUICK_ACCEPT":0,"CLARIFY":0,"TEST":1,"TEST_DEEP_OR_BUG_EVIDENCE":1,"LOGIC_OR_DESIGN_CHANGE":1,"ACCEPTED_CAPABILITIES":0} -->


---

## 7. V10 Google-only guarded importer — **new bounded follow-up** (2026-11-04)

**Decision interpreted:** the owner's follow-up "Начнем" authorized development and real testing of the next **Google-only four active/planned WorkOrders + two active Workers** guarded importer, **not canonical Neon TEST, Render, main or PROD promotion**. It did not waive exact private ID-pair signoff, source-cutoff or dual-writer policy decisions, and it did not authorize the extra Shadow-only chain.

**MODE:** IMPLEMENT_FEATURE / isolated migration prep. **SOURCE_BASE:** earlier V9D TEST exact commit \`5a2151527854077b266f2d0e7113df6675bc85bb\` plus documentation-only V10 PR #1175. **OWNER_LANE:** \`prep/vbos-clean-v10-fast-start-20261104\` (still draft, NOT MERGED). **RISK:** L3 data contracts. The original V10 rehearsal on \`br-fragrant-mountain-b9t4e7fg\` is not the new Google-only test; it remains separate for the historical Shadow check.

### Exact new files and code boundaries

- \`domains/fast-start/V10_GUARDED_GOOGLE_REHEARSAL_ONLY.sql\` — independent SQL, intentionally **NOT an installable migration for canonical Neon**. DDL plus an owner-invoked stored function that imports exactly four operational Google WorkOrders and two active Workers. Requires an **externally staged private source set** and existing 35 identity pairs, explicitly approved temporary-branch guard and frozen source/map manifests. All writes inside **one PostgreSQL function call / transaction**, and no broad public grants.
- \`domains/fast-start/V10_GOOGLE_REHEARSAL_QA.sql\` — private-data-free repeatable PostgreSQL QA, tested on the real separate Neon branch. Exercises exact source-to-target readback, same-payload idempotence and rollback of three targeted mutations plus canonical-branch-argument denial.
- Only V10-specific documentation and these two new SQL files changed; **no** \`server.mjs\`, PWA UI, WorkLog/finance, Google Apps Script, Render service, CI workflow, canonical Neon schema or other lane.

**Exact PostgreSQL runtime rehearsal:** Neon project \`proud-hat-90291191\`, **disposable** branch \`br-misty-rice-b9c3c277\` (copied from canonical \`br-crimson-hat-b9kwg7n6\`, parent LSN \`0/2974770\`), database \`vbos_mvp_clean\`. Source Google metadata \`modifiedTime=2026-11-03T19:06:09.263Z\` remained unchanged at bounded source reads. Private ID-map file reported \`shared=false\` and owner-only permissions.

**Staged restricted evidence:** 21 WorkOrders, 2 Workers, 35 owner-equivalence candidate client/object mapping rows. The input source fields were kept as raw UTF-8 JSON text; each stored SHA-256 is enforced by a PostgreSQL CHECK over the exact raw bytes. All 35 private pair hashes are validated against their original nine-field JSON source. Source and map batch manifests use SHA-256 over sorted original IDs + individual hashes. Before any target write, the official 35 existing \`mvp_legacy_import_map\` pairs matched exactly (35/35), including the 18/18 object-parent Clean UUID relationships. These are still owner business-entity equivalences, not row-by-row signed release approval (\`EXACT_PAIR_REVIEW_PENDING\`).

**Positive actual execution — PASS:**
- \`v10_faststart.run_google_rehearsal(...)\` returned \`DISPOSABLE_REHEARSAL_ONLY / IMPORTED\`, **4 orders + 2 workers** inserted, 17 older completed/archived WorkOrders left source-only (not reopened), no Shadow source rows imported.
- Existing \`public.mvp_legacy_import_map\` preserved all 35 original mappings and added **6 immutable legacy-ID → fresh Clean UUID provenance rows** with full original Google JSON: **35 → 41**. Clean \`mvp_orders\` became 4 (2 \`active\`, 2 \`open\`), \`mvp_workers\` became 2; all orders attached to existing objects, never inferred lead UUIDs.
- The two Google original \`planned\` values were mapped provisionally to Clean \`open\` **only for rehearsal**; original status and all original 23-field source order facts are retained in provenance and individual receipt. User has **not yet accepted this release policy**.
- All 4 Google operational orders lacked source planned dates, so **0 new auto ScheduleItems** is correct (no invented current-day tasks). One existing manual plan preserved. No workers assigned: the single historical assignment was \`removed\` in Google and is not reactivated.
- 4/4 operational WorkOrder field/link/hash/provenance parity and 2/2 Worker field/hash/provenance parity checked against private staged originals. 6/6 import receipts created; each target's full PostgreSQL row digest stored.
- **Idempotent replay PASS:** same exact staged manifests invoked the same guarded function again; returned \`IDEMPOTENT_REPLAY\` and inserted 0 new orders/workers/plans; target counts unchanged.
- **Source drift negative PASS:** appended a byte to an otherwise equivalent staged raw JSON with recomputed individual SHA; batch-manifest gate denied it and the nested test transaction rolled back the mutation.
- **Target edit negative PASS:** simulated an edit to an existing imported WorkOrder; receipt hash gate denied replay and rolled back the temporary change.
- **Identity tamper negative PASS:** simulated replacing a mapped Clean object UUID; existing canonical ID-map gate denied it and rolled the change back.
- **Canonical-branch argument negative PASS:** passing \`br-crimson-hat-b9kwg7n6\` was rejected by the rehearsal guard.
- **Real SQL QA file PASS:** executed exact checked-in \`V10_GOOGLE_REHEARSAL_QA.sql\` in this disposable PostgreSQL. PostgreSQL executed one nested-exception test statement successfully; no synthetic mutations leaked.
- **Least-privilege ACL readback:** 0 PUBLIC grants on staging schema, 0 PUBLIC table grants and 0 PUBLIC execute on guarded function. **Only this isolated schema was audited**; future canonical role/access security review is separate.
- Source's **27/27 public tables** stayed present; only 3 tables changed row counts **in the disposable clone**: legacy map 35→41, orders 0→4 and workers 0→2. Original 24 other public table counts identical. No payroll, WorkLogs, WorkerDays, finance facts, assignments or owner fields fabricated.

### Release blocker / safety and rollback

This SQL explicitly runs **rehearsals only** and must not be used verbatim for a canonical TEST release. Physical Neon targeting is enforced by the executor's explicitly selected branch plus the checked external guard; a user-supplied SQL branch-name parameter is **not cryptographic proof of the actual connection's Neon branch**. Canonical release requires a separate code adapter/approved versioned migration and connection/role attestation. Do **not** weaken the role/status gates merely to get a green test.

Still **NOT_RUN / BLOCKED**:
1. Owner signing each of the private 35 client/object exact mapping pairs; the earlier business equivalence is accepted but pair execution review remains pending.
2. Owner decision whether mapped old \`planned\` becomes new \`open\`, and the **single-writer authority/cutoff** for imported live WorkOrders. Uncontrolled two-way edits in Google and Clean risk lost data. The Clean UI currently permits editing orders; promoting data without resolving this is unsafe.
3. Fresh final double-read/frozen source snapshot at migration cutoff with external manifest receipt; imported source here was read after verifying unchanged prior Google metadata but was **not an owner-approved production cutoff**.
4. An **installable canonical TEST migration** with precise version/checksum, verified preflight snapshot/backup, explicitly permitted target, strict transactional release runner, irreversible-history treatment and rollback, followed by separate authorization. This rehearsal script is **not** that authorization.
5. Live authenticated browser test on Render with imported records, user device acceptance and PROD (no V10 Render deploy performed).

**Rollback BEFORE approval:** no operational rollback needed, because primary Neon and Render remain untouched. The new disposable branch may be deleted after preservation decision without affecting canonical rows. The two private-data-containing test branches must not be published or used as PROD sources. In a separately authorized future canonical import, backup first and never restore old snapshots over newer user writes. Preserve original IDs and stored payloads; stop writers, perform validated per-row inverse only if no dependents, or restore from an exact PIT with separate owner permission.

**STATE:** \`GOOGLE_4_ORDERS_2_WORKERS_GUARDED_REHEARSAL_TECHNICALLY_VERIFIED / NO_CANONICAL_WRITE / NO_RELEASE_APPROVAL / STOP\`.

<!-- HI_V1 {"date":"2026-11-04","SESSION_ID":"vbos-clean-v10-google-guarded-import-20261104","REVISION":1,"NUDGE":0,"NEXT":1,"QUICK_ACCEPT":0,"CLARIFY":0,"TEST":1,"TEST_DEEP_OR_BUG_EVIDENCE":1,"LOGIC_OR_DESIGN_CHANGE":1,"ACCEPTED_CAPABILITIES":0} -->


---

## 8. Owner decision and Google single-writer WorkOrder guard (2026-11-04)

**Owner response:** "Утверждаю" immediately following the recommendation to accept: (a) mapping original Google \`planned\` to Clean \`open\` while preserving original status, (b) Google remains canonical writer for imported WorkOrder card/status until separately authorized cutover, (c) the 35 exact existing legacy client/object pairs in the separately linked owner-only map. This is a **business-policy approval tied to the owner-private map manifest**, not a command to execute an as-yet-unreviewed canonical Neon migration, Render release or PROD write.

**Approved identity evidence anchor:** private workbook owner-only permission reverified, \`modifiedTime=2026-11-04T11:06:54.700Z\` unchanged; source workbook \`modifiedTime=2026-11-03T19:06:09.263Z\` unchanged. Owner-private CONTROL declared map manifest SHA-256 \`0332089b28feb43f19a83eb7ddb274c7177c57d33ba7fa73b6a1e83e174a5a2b\`. Newly verified exact **35/35 mapped source-ID→Clean-UUID pairs** against canonical \`mvp_legacy_import_map\`, **35/35 private row SHA-256**, **18/18 object parent links**. No private ID/name/phone/address was placed in this PR. The source workbook still has \`EXACT_PAIR_REVIEW_PENDING\` in 35 rows and \`NOT_SIGNED_PER_ROW\` in CONTROL; this text records the ChatGPT conversation's owner confirmation but does **not** forge a Google-sheet row signature or rewrite those private hashes. A future release preflight must require hash/manifest equality to the approved frozen snapshot rather than silently accepting a changed map.

**Google-only runtime policy implemented in proposed, unmerged source:**
- \`migrations/0008_v10_legacy_provenance.sql\`: additive idempotent compatibility for the existing canonical \`mvp_legacy_import_map\` table, which was absent from clean disposable \`schema.sql\`. The exact canonical column set and its two constraints (composite source PK, unique target per source entity) were read back and mirrored. Applied twice against the isolated test Neon with 41 existing provenance rows: **PASS / no data loss**. No canonical Neon migration executed.
- \`order-schedule.mjs\`: exact legacy Google WorkOrder provenance is checked in the order transaction before any \`order_update\` or \`order_status\` mutation. Imported Google-owned WorkOrders are **server-side 409 read-only**. Clean-created orders still allow ordinary update/status. Idempotent action receipts remain transactionally guarded.
- \`server.mjs\`: \`work_start_order\` on Google-owned Order may create a real work session, but **must not** auto-advance its Clean lifecycle from \`open\` to \`active\` or rewrite the automatic schedule. For non-Google-native orders the existing action is untouched. Owner-authorized \`GET /api/state\` returns bounded \`legacyGoogleOrderIds\` and \`legacyGoogleOrderStatusById\` for correct UI display; never exposes original private IDs or legacy source JSON.
- \`public/app.js\`: imported Google-owned order details display both the Clean status and original Google status. Remove edit/status buttons for such records, but retain worker assignments and new work entry through the existing screens.
- \`tests/e2e.mjs\`: local disposable PostgreSQL creates \`0008\` twice and asserts additive compatibility; synthetic owner-auth HTTP tests verify imported order 409 update/status, retained original \`planned\`, worker assignment allowed, work start and WorkLog allowed, and order status/revision preserved. No historical real-business data in test source.

**Verification:** GitHub Clean MVP CI with full synthetic HTTP E2E real local PostgreSQL independently verified \`V10_GOOGLE_LEGACY_ID_PROVENANCE_ADDITIVE_SCHEMA_TWICE_PASS\` and \`V10_GOOGLE_ORDER_DENY_METADATA_EDITS_ALLOW_ASSIGNMENT_SESSION_LOG_PRESERVE_STATUS_PASS\`; bootstrap CI separately PASS. This is an actual local-PostgreSQL runtime test, **not an authenticated owner-device Render V10 test**. Exact current commit and CI receipt must be read back from GitHub before promotion.

**Release gate:** no automatic TEST deployment follows this approval. The draft SQL \`V10_GUARDED_GOOGLE_REHEARSAL_ONLY.sql\` deliberately accepts **only disposable Neon**. Before canonical data import, prepare a **separate owner-approved exact-source migration/import package** with final source readback, DB backup/PIT snapshot, signed manifest proof, real canonical migration checks, strict source-only writer policy, rollback and readback. Never reinterpret approval of business rules as authority for unexpected PROD, Google Sheet structure, Render or exact canonical Neon mutation.

**Current state:** \`BUSINESS_POLICY_APPROVED / FROZEN_35_MAPPING_CONFIRMED / GOOGLE_READONLY_RUNTIME_CANDIDATE / CANONICAL_V10_RELEASE_NOT_RUN\`. Existing V9D Render remains live and unchanged. No files need manual copying.
