# SOP / KnowledgeItems source-to-Clean migration plan — 0038 (candidate, not executed)

**CAPABILITY_ID:** VBOS_CLEAN_LEGACY_KNOWLEDGE_SOP_COPY_V1
**WORKFLOW_MODE:** IMPLEMENT_FEATURE (faithful legacy copy, not new functionality)
**RISK_CLASS:** L3: original IDs, source authority and editable business records
**STATUS:** S1 INTEGRATION CANDIDATE / MIGRATION_NOT_AUTHORIZED / TEST_NOT_DEPLOYED
**LEGACY SOURCE:** VahramSargsyan/vbos-app/main@6cef8d3910fdba5353d2eb70b45b50929d97a259
**CLEAN BASE:** VahramSargsyan/vbos-clean/main@f3db56a8fd2b0ca72780e4fd863ca65d361d2fc7
**RUNTIME TEST TARGET:** existing https://vbos-clean-mvp-2026.onrender.com/ only after accepted scope and guarded exact SHA; currently occupied.
**OWNER:** Vahram; needs owner acceptance of the source record migration/cutover before applying DDL or moving materials.
**DATA OWNER (NOW):** old VBOS KnowledgeItems (Google by default; verify actual backend property and potential Supabase M8A shadow/cutover separately). Do **not** claim Google still writable solely from old source documentation.

## Existing legacy contract to copy

- Screen: `Knowledge.html` and `Scripts.html` block `knowledgeItemById_` through `toggleKnowledgeFavorite_`.
- Canonical fields (`Config.js`): knowledgeId, createdAt, updatedAt, status, type, code, title, sectionPath, summary, fullText, tags, version, sourceName, sourceVersion, sortOrder, priority, favorite, clientRequestId.
- Stable IDs generated from prefix `KNW`, year, per-year durable sequence (`KNW-YYYY-0001` format); existing IDs must remain byte-identical. Do not mint Clean IDs while old writer is active.
- **Exact year boundary:** original `IdService.js::generateStableIdUnlocked_` uses `new Date().getFullYear()` under legacy `appsscript.json` timezone `Asia/Yerevan`, not UTC. Clean helper `knowledgeYear()` preserves this; regression fixture verifies 2026-12-31T20:00:00Z maps to `2027` for a new ID. Sequence must be initialized independently for every legacy year at cutover.
- Legacy read sorting: favorite first, sortOrder ascending, code ru natural-numeric. Filters: stage from code/terms, search across code/title/sectionPath/summary/fullText/tags/sourceName, type, status and favorites.
- Legacy edits: owner create/update/favorite, online only; user-facing editor preserves original max lengths and enums; duplicate request replay has identical result.
- Original seed metadata: `Карта SOP системы бизнеса v0.2.62`, **64 seed cards claimed by source** including 61 detailed cards. This is **not** a verified live snapshot row count. No card fullText or actual original record is embedded into public Clean GitHub.
- **Read-only live Google inspection, 2026-11-20:** the connected workbook titled `Working IP APP` has a visible `KnowledgeItems` sheet with the **exact 18 original headers**. Range A2:A120 contains **64 non-empty distinct IDs**, `KNW-2026-0001` through `KNW-2026-0064`; B2:C65 has 64 non-empty created/updated timestamp pairs (all displayed updatedAt `2026-08-13T07:38:03.430Z`). This supports count/ID-format only; **does not prove that the Google sheet remains current write authority after M8A API cutover**, or that row contents are reconciled with any newer shadow/API copy. No private spreadsheet identifier or SOP full text is added to this PUBLIC repository.
- Source origin data may be private or contain proprietary business details. Public repository must contain **code and synthetic fixtures only**.

## Proposed additive destination

- `migrations/0038_legacy_sop_knowledge_CANDIDATE.sql` only creates fresh `mvp_knowledge_items`, `mvp_knowledge_requests`, `mvp_knowledge_sequences`, and one `mvp_knowledge_authority` row with `phase=LEGACY` and empty snapshot hash. No writes to existing tables; no initial SOP cards inserted.
- Read `GET /api/knowledge` requires signed owner cookie. Data are visible when table exists, explicitly labeled blocked from editing until migration confirmation. POST `/api/knowledge/save` is behind same origin/owner session AND DB phase/hash gate; `LEGACY` cannot create, update or favorite.
- A later cutover may move phase to CLEAN only after signed snapshot coverage, no competing Google/API writer, sequence initialization and rollback rehearsal. The presence of this SQL file alone is **not** authority to activate it.

## Before applying migration / importing any real content

1. Inspect old runtime's actual `VBOS_KNOWLEDGE_BACKEND` and current live `KnowledgeItems` source, including any M8A Supabase endpoint. Never infer current writer from old planning documents.
2. Obtain a private as-of export through an explicitly authorized source mechanism; back up source with row hashes and immutable provenance. Protect card contents/customer data; **do not commit into public GitHub or send secrets in chat**.
3. Prove snapshot count/IDs/uniqueness and complete field coverage, including source timestamps, favorites and exact code/title. Confirm whether source has additions since the August seed (64 is metadata, not a target count).
4. Verify every existing `KNW-YYYY-NNNN` ID and per-year **maximum sequence**. Stage historical rows with `source_system=LEGACY_GOOGLE` as provenance (relabel if actual source differs; any provenance enum adjustment requires approved migration).
5. Run additive SQL first on disposable local PostgreSQL only; run unit and E2E tests with no real records. Prepare backup/restore for intended target, record exact applied DDL SHA, then apply to isolated TEST through a separately authorized migration runner. Never directly mutate occupied Neon TEST in this block.
6. Privately import same exact records, reconcile hashes and sort/filter/read behavior, no duplicate or missing items. Validate creation/update/favorite on an independently isolated replica.
7. Freeze the prior writer and define no dual-authority window; owner signs source snapshot as-of and new data owner. Seed `mvp_knowledge_sequences` past max imported sequence. Only then activate CLEAN writer gate in guarded TEST and perform authenticated owner acceptance. Any mismatch => fail closed, do not activate.
8. Protected exact-source TEST release plus owner Android scenario: list, stage chips/mobile dropdown, filters, search, full text, favorite, edit, create, save/reload, duplicate request and error. Compare to old screen rather than redesigning it.

## Rollback

- Before activation: revert application feature branch / close PR. SQL remains inert; **do not drop unreviewed tables containing data**.
- TEST after DDL with no imported rows: conditional transaction may remove four isolated 0038 tables **only when** `phase=LEGACY`, `source_snapshot_hash=''`, and item/request/sequence counts all zero. This cleanup needs separate owner authorization and a backup.
- After an import or CLEAN activation: STOP writes, checkpoint TEST and restore the exact protected pre-migration backup and prior source authority using a signed reversal plan. **Never** automatically turn old Google writer back on without verifying no divergence; do not reissue original IDs.
- No PROD/Google Sheet structural edits, no unrelated schema changes, no paid API or new service.

## Tests and open gates

- Pure legacy parity, UI structure, mutation fence and source-local static checks: candidate test files included.
- Actual Node `npm test`, `npm run verify:source` and localhost PostgreSQL E2E: **NOT_RUN** until runnable environment (no standing GitHub Actions authorization).
- Live source export, private data coverage and cutover as-of: **NOT_RUN / blocked**.
- Authenticated installed TEST and owner Android acceptance: **NOT_RUN**.
- Current hosted Render TEST and occupied Neon are not touched.

## S1 integration receipt (2026-11-24)
Original PR #18 `7878f9f10bc52eb0e55a06fc1e29efe7cfef54bc` passed real Node22 and isolated PG16 run 44869090224 on 2026-11-21. The unapplied original SOP 0037 was renumbered to 0038 because accepted Finance owns 0037; SQL is byte-identical. This is a filename change before deployment, not a DB schema change. Current S1 authorizes source integration only. No real data import, DDL on occupied TEST, writer switch, hosted deployment, or PROD. Source authority still unverified. Current candidate PG17 regression requires new authorization; historical PG16 PASS is not S1 qualification. Rollback before deployment: discard candidate; currently installed A1 d52e635546cb5d5c2f5653861fdc8e0937c51c28 / dep-dc2ui7k9v7es73ernkmg remains untouched.


## S2/S3 supplement — 2026-11-25 (current, supersedes older source assumptions)

- **Source decision:** Supabase `app.knowledge_items` is the last confirmed accepted legacy authority, based on the owner's M8A ACCEPTED property receipt and live database readback. Google retains a matching earlier copy. The live backend flag has not been directly read; freeze and verify the old writer before any CLEAN activation. No writer change in S3.
- **Live preflight:** 64 rows, 64 unique IDs, year 2026 and maximum suffix 64; 63 SQL NULL `client_request_id` values; all other existing target enum/length/title constraints pass. All 18 legacy logical fields are retained. Google versus Supabase differs on two technical fields of one record only (comparison normalized NULL/empty and timestamps to milliseconds). Real source canonical SHA-256 calculated in a single read-only SQL statement, canonical size 871563 UTF-8 bytes; fingerprint retained in private owner receipt, not raw records in GitHub. Re-read count/hash before transfer; any drift stops this 64-row scope.
- **Candidate schema adjustment:** unapplied 0038 now accepts provenance `LEGACY_SUPABASE` and preserves SQL NULL client_request_id for imported records; native writes still require non-NULL. Prior LEGACY_GOOGLE and CLEAN_NATIVE values remain supported. No applied migration is rewritten. Source System is additional target provenance, not one of the original 18 fields.
- **Versioned transfer:** `0038_legacy_sop_knowledge_EXPORT.sql` reads a consistent source snapshot with format, count, SHA-256 and all 18 fields. Timestamp precision is UTC six decimal digits; numeric sort_order is exact normalized decimal text; JSON null remains null. Do not coalesce or trim source text, change IDs, timestamps, or client request IDs. SHA-256 covers the ordered canonical JSONB array. Export is private; do not use GitHub, CI logs, public links, SQL inline literals, or chat for the record payload.
- **Import:** `0038_legacy_sop_knowledge_IMPORT.sql` is a transaction fragment, not a standalone hosted deployment. The approved private migration runner must check the exact target identity, protected backup and restore anchor; open a single transaction, apply the unapplied exact DDL (remove its outer BEGIN/COMMIT for composition), create TEMP TABLE sop_s3_snapshot_input(snapshot jsonb NOT NULL,expected_sha256 text NOT NULL) ON COMMIT DROP; bind the private JSON and independently captured expected SHA-256 using parameterized INSERT. Execute the import fragment; inspect receipt while the transaction is open. Reject wrong count/hash/fields/ID, dirty target, non-LEGACY authority, existing requests, provenance/sequence mismatch, or changed replay. Identical replay is non-mutating. Initializes sequences to per-year maximum (2026=64); no new IDs minted. Import sets the snapshot hash while phase remains LEGACY, so read-only access is possible, but save/favorite/create remain blocked. COMMIT only under separate exact-target import approval; on any mismatch ROLLBACK. No CLEAN activation in this runner.
- **Rollback:** rehearsal rolls back the entire migration transaction and verifies temporary objects disappear. For a later committed real import, preserve backup and use the separately authorized restore/reversal plan, never auto-delete or re-enable either old writer. Source freeze, current runtime flag, fresh private snapshot, real post-import field/hash parity and authorization remain required before writer activation.
- **Rehearsal receipt:** existing Neon separate staging database (not occupied Clean TEST) is PostgreSQL 17.12 and has 58 non-system tables, so used only session-local pg_temp objects and savepoints, never changed persistent schema. Executed the exact revised DDL/export/import SQL with namespace-only substitutions. 64 synthetic records, 18-field bidirectional EXCEPT equality including 63 NULLs and microsecond timestamps, sequence=64, LEGACY fence, no requests, checksum rejection with zero rows, identical replay, modified-target rejection, rollback PASS. Post-check staging still 58 tables and zero SOP/rehearsal tables; occupied TEST zero SOP tables. Reproducible localhost test `tests/knowledge-sop-import.pg.e2e.mjs` added to the existing test:e2e chain. Current source fingerprint and synthetic PostgreSQL proof do not constitute real-data destination parity.
- **S3 boundary:** no persistent data import, no occupied TEST DDL, no Render deploy, no PROD, no writer switch, no Codex, no new Actions. Current modified candidate requires native Node/full PG CI before release (prior S1 CI remains valid only for prior exact source). Real data destination parity NOT_RUN; private bound-parameter runner/access and approved backup/target are next-gate prerequisites. S3 preparation/rehearsal only.
