# Engineering / VBOS Clean PWA — isolated draft contract

CAPABILITY_ID: VBOS_CLEAN_PWA_ENGINEERING_CONTRACT_V1
WORKFLOW_MODE: NEW_APP_DISCOVERY / AUDIT_ONLY + explicitly permitted isolated read-only candidate
STATUS: DRAFT_NOT_CONNECTED; NO_ENGINE_RUNTIME; NO_DEPLOY; NO_DB_WRITES
BASE_PWA_COMMIT: 9f3a9ee83d747b447a38aea45995bedd10b2b0cf
RISK_CLASS: L1 isolated API-neutral contract; downstream DB/API integration L3
CANONICAL: Legacy Engineering remains owner of engineering source; Clean PWA PostgreSQL remains owner of mvp_objects and business entities.
MIGRATION_REQUIRED: NO for these files; YES before any persisted Engineering cutover.
FILES_TO_DEPLOY_OR_COPY: NONE
ROLLBACK: discard this isolated branch; shared runtime and TEST manifests unchanged.

contract.mjs is an original authored, read-only Node ESM DTO validator plus deterministic SHA-256 projection fingerprint; it does not copy any engineering kernel or OSS source. It accepts explicit stable engineering project/floor/room/zone IDs and mm coordinates; optional linked PostgreSQL mvp_objects UUID is separate from the legacy Engineering ID. It refuses missing exact 40-character source commit/revision and unsafe units/geometry point formats. It does **not** certify physical geometry, heat loss, connected UFH, or hydraulics.

Local check:
    node --check devtools/vbos-mvp-clean/domains/engineering/contract.mjs
    node --test devtools/vbos-mvp-clean/domains/engineering/contract.test.mjs

Future calculation envelope must retain source commit, engine version, revision, fingerprint, units, warnings and status COMPLETE/INCOMPLETE/UNSUPPORTED; existing engines own all physical acceptance checks. Do not add imports to server.mjs, public/app.js, index.html, migrations or manifests until the lead app owner approves a separately scoped integration.

Observed engine evidence: historical local heat-loss/hydraulic kernels (H1; ground Annex E NOT IMPLEMENTED); UFH Apache-2.0 adapted pure geometry kernel local H2 and bounded rectangular active-area TEST acceptance; MiniCAD historical wall drawing TEST acceptance; radiator/commercial derived H5 subset on main, H5H persisted runtime NOT_RUN due to TEST lane reassignment. Engineering core PostgreSQL migration readiness ENGINEERING_CORE_STABLE is not verified.

External license evidence is from docs/product/oss/OSS_SOURCE_REGISTRY.json on the Engineering OSS branch, not independent upstream verification. OpenHeatLoss AGPL-3.0 REFERENCE_ONLY; underfloor-heating-designer Apache-2.0 adapted with notices; opti-pipe MIT; react-planner MIT reference; IfcOpenShell mixed GPL/LGPL requires component review; EnergyPlus/OpenStudio external verification only. Re-check exact license/dependencies before copying external code.

Full audit, adapter interface, proposed units/errors/result envelope, test fixtures, migration blockers and handoff: VBOS_CLEAN_PWA_ENGINEERING_DISCOVERY_CONTRACT_2026-11-04.md (companion audit report supplied separately).

NOT_RUN: engineering exact-head runtime, PWA engineering browser flow, SQL migration, authentication/authorization integration, realistic drawings import/export, upstream license/SBOM audit, TEST deployment, PROD.

## V2 draft source-identity hardening — 2026-11-04

The identical filename/version `EngineeringSchema_v0_9_1.js` occurs with **different Git blobs and different exclusion semantics** in pinned TEST source versus the working UFH branch. Therefore a schema version string alone is NOT a reliable source authority. The V2 draft snapshot now requires `source.schemaBlobSha` (40-hex Git blob hash) in addition to exact `source.commitSha`, `source.schemaVersion` and revision; the new triple is included in the geometry fingerprint.

`verifyEngineeringSourceLock(snapshot, trustedLock)` accepts only exact source-commit/blob/version equality. `trustedLock` MUST be supplied from a separately verified repository/release record, never accepted from the user's snapshot or frontend payload. `SOURCE_TUPLE_MATCH` means identity equality only, **not** TEST runtime acceptance, engineering calculation correctness or approved DB migration.

Reproduce locally (without PWA runtime or DB): `node --check devtools/vbos-mvp-clean/domains/engineering/contract.mjs && node --test devtools/vbos-mvp-clean/domains/engineering/contract.test.mjs`. The new draft has 18 deterministic local checks; it is not imported by `server.mjs`, `package.json` or the PWA UI and is NOT included in the existing npm test script. See `SOURCE_LOCK_EVIDENCE.md` for pinned candidates, incompatible blob evidence and STOP boundary. V1 draft fixture payloads must explicitly migrate to V2 before any future integration; no persisted runtime V1 payloads are known.

No changes to shared files, SQL, release manifests, Engineering engines, user data or deployments.

## Engineering Read-Only Preview V1 — isolated feature candidate, 2026-11-04

MODE: IMPLEMENT_FEATURE; OWNER: VBOS Clean PWA Engineering candidate. TEST lane: NOT_ASSIGNED; no release or deployment authorization inferred.
BASE_PARENT: 98887cd2b93933514f66e103c1b355a371a1deb5 (V2 source lock).
EXPECTED_RESULT: inside the authenticated Clean PWA menu, "Инженерия · демо" presents a two-floor, five-room SCHEMA-ALIGNED SYNTHETIC snapshot with SVG room outlines, contour areas, stable legacy IDs, floor/room navigation and source provenance. This is a functional read-only UI candidate, NOT real Google Engineering project import, engineering computation, or approved production integration.
CANONICAL: Legacy Engineering entities/IDs remain authoritative there; Clean PWA PostgreSQL stays business-data authority. There is no relation by sheet row number and no DB write.
EXPLICIT NON-GOALS: migration, Google Sheets API read, Neon/Render change, heat loss, UFH routing, material estimate, engineering save/edit, automatic business-object linking.

Touched files in isolated feature branch only:
- `public/engineering-preview.mjs`: browser/Node pure read-only adapter, synthetic rows, SVG renderer.
- `public/engineering-preview.css`: scoped mobile presentation.
- `public/app.js`: dynamic module load on authenticated engineering-tab selection, in-memory floor/room state.
- `public/index.html`: navigation + stylesheet.
- `server.mjs`: static whitelist for only the two new public assets; no routes/actions/API writes.
- `tests/engineering-preview.test.mjs` and `package.json`: tests integrated into npm test.

Source gate: the example uses the exact pinned UFH TEST source SHA `ce72ffdcd1d0eaa04113bcb32f9b4b6065be39f9` and schema Git blob `49afa9d7a557ec4f493925b9895810dd2085d1f7`; its rows are synthetic and make **no** claim that deployed TEST contains these example rooms. `NO_HEAT` is intentionally absent from the pinned source's declared exclusions. Room area = polygon shoelace/1e6 (gross centerline zone area), NOT net area or UFH active area; no wall thickness subtraction.

Acceptance/repro: `cd devtools/vbos-mvp-clean && npm test`; separately `node --test tests/engineering-preview.test.mjs`. Verify after a future authorized separate TEST install: owner sign-in, menu Engineering, switch floors, inspect rooms and area labels, return to Today/Clients; ensure no persistence. The parent PWA CI and live browser acceptance must be checked separately.

Risk class: L2 candidate due to scoped PWA entrypoint changes; no shared legacy Engineering or DB mutation. Migration: NO. Rollback: revert this isolated feature commit/branch to parent `98887cd...`; no schema restoration necessary. No changes to PROD/STAGING or occupied Engineering TEST lanes. External OSS: no source copy or new dependencies.
Stop before loading real engineering data: select one exact accepted source/schema baseline, obtain independent read-only source adapter + exact parent/revision verification, verify runtime auth/privacy and engineer owner acceptance. No automatic TEST/PROD promotion.

## V10 source reconciliation — 2026-11-04

SOURCE INTEGRATION BASE: `cfc7e2bd4569b7ae02ac5378c24002cec12bb259`, the exact Clean PWA V10 commit installed as Render TEST deployment `dep-dblj2sjncjis73e0k3bg`. This section supersedes the older V9D-based TEST preparation notes for *this* integration checkpoint only.

The candidate's Engineering additions are applied as a **two-parent merge** against the entire V10 tree, retaining both the V10 Google-canonical WorkOrder guard/API modifications and the full Engineering preview feature lineage. No SQL migration or Google/Neon write is part of the Engineering preview. Previous standalone Engineering candidate: `4a93ece9fc144494e04af6858aaf7875879d1817`.

New preview source is a synthetic geometry fixture; the authenticated owner can view 2 floors, 5 sample rooms and polygon (gross) areas after an explicitly authorized TEST release. The new feature does not import or render actual private legacy Engineering projects.

TEST/RELEASE GATE: GitHub CI and source comparison first. Do not assume V10 end-user acceptance just because it became Render live. Do not trigger Render directly from isolated feature branch; its service tracks the shared clean source branch. Resolve exclusive TEST release sequencing, snapshot/rollback, source parity and owner acceptance before any deployment.


## H1 calculation capability — first real legacy source port (2026-11-04)

CAPABILITY_ID: VBOS_CLEAN_ENGINEERING_MANUAL_ROOM_HEAT_AND_RADIATOR_H1
USER_RESULT: User manually enters real room dimensions/areas/U-values, indoor/outdoor design conditions, ACH and air factor; calculates explicit-envelope transmission and ventilation heat loss, optional reserve, and corrects manufacturer nominal radiator power at actual supply/return/room temperatures to size a single radiator model or sectional count. This is the first computational capability, **not** a demo geometry projection.
WORKFLOW_MODE: IMPLEMENT_FEATURE
RISK_CLASS: L2 technical calculation in isolated PWA client; no server data persistence or legacy live cutover.
BASE_COMMIT: ef368e2dc57273bfb6757eee9beef2ba14011640
OWNER_BRANCH: feature/vbos-clean-engineering-calculators-h1-20261104
TEST_TARGET: Clean PWA shared Render TEST only after feature CI and TEST slot/rollback check; no auto promotion.
CANONICAL: Exact original legacy source, commit 5a2621c84d285708036c6d5dadd435f5bc3d7e06:
- EngineeringHeatLossEngine_v0_1_0.js Git blob bc66bff2948618aa9f97cfca510cd52cae960b63 (preserved unmodified core; only browser ESM export appended)
- EngineeringRadiatorSizingEngine_v0_1_0.js Git blob d27605dd3fbacc0dd81f241798d25bd14da46b6a (preserved unmodified core; only browser ESM export appended).
- No external library adopted, no new pricing/engineering formulas invented. This is not a certified heat-loss compliance engine or a validated floor-ground transfer solver.

INPUT DATA: User-entered geometry + exterior net surface areas and manufacturer U-values, explicit floor/ceiling boundary types, outdoor/indoor temperatures, ACH, volumetric air heat factor, reserve, optional externally validated ground W, optional UFH contribution, radiator catalog W at reference delta-T and exponent n, actual temperature regime. Missing/invalid fields fail closed, wall area excludes window/door area. Floor-to-ground heat loss needs a separately validated supplied W (never silently approximated). Adjacent heated spaces are explicitly user-selected as zero boundary loss. No default climate values or normative radiator data.
OUTPUT: breakdown by wall/window/door/floor/ceiling, ventilation W, base W, required W with explicit reserve; optionally residual radiator demand after explicitly labelled UFH/other contributions, corrected radiator W and units/sections with status/warnings.
SCOPE: four new static calculation assets (two source ESM adapters, UI ESM, CSS), one new deterministic test file, app navigation/submit and static file whitelist, package test. The old synthetic preview remains in repository but is not the main Engineering route.
OUT OF SCOPE: actual engineering project import/persistence, legacy Engineering authority cutover, code execution against Sheets, heating pump/hydraulics, UFH geometry and heat output, price/estimate transfer, certified compliance or production release.
SHARED HOTSPOTS: devtools/vbos-mvp-clean/public/app.js and server.mjs. No migrations, no new SQL, no owner DB writes.
ACCEPTANCE: compare manual 10m² wall U0.4, 2m² window U1.6, Tin20/Tout-10, 50m³ ACH0.5 factor0.34, reserve10% -> 518.1 W; a 70/50 regime must derate a nominal 1500 W at ΔT50 exponent1.3 and size >=1; ground requires independent validated input; malformed/blank inputs blocked; Android owner inputs and V10 regression after a separately permitted TEST deployment.
ROLLBACK: keep current exact Clean TEST commit ef368e2dc57273bfb6757eee9beef2ba14011640. No DB restore or migrations needed for this client-only block.
CHECKPOINT: isolated candidate; GitHub CI and mobile TEST not yet performed at authoring; record real results in PR. No Codex, paid API, PROD, Google TEST or shared TEST mutation.


## P1 — real geometry-first rectangle drawing → source-native thermal (2026-11-04)

CAPABILITY_ID: VBOS_CLEAN_ENGINEERING_DRAWING_FIRST_RECTANGLE_THERMAL_P1
WORKFLOW_MODE: IMPLEMENT_FEATURE
USER_RESULT: Draw an actual rectangular room in millimetres on mobile touch surface; assign exterior/heated-adjacent wall roles; add windows and doors on exterior walls; calculate physical net floor area, volume, envelope and heat loss automatically from the drawn geometry without re-entering areas.
RISK_CLASS: L2 read-only client calculations / in-memory editable drawing; no canonical DB, schemas or legacy authority changes.
BASE_COMMIT: 9646ff8c1c3db8e24b6d6d53d67389d511af4fee
OWNER_BRANCH: feature/vbos-clean-eng-drawing-first-p1-20261104
TEST_TARGET: existing Clean PWA Render TEST after exact CI and shared-lane verification. No automatic PROD/Google TEST deployment.
CANONICAL: Legacy Google Engineering retains its source-of-truth project/floor/room IDs. Clean P1 uses distinct CLEAN_PWA_DRAFT_NOT_LEGACY records; no historical project is imported or rewritten. The H1 manual calculator is retained collapsed.
SOURCE: Original Engineering Thermal commit 5a2621c84d285708036c6d5dadd435f5bc3d7e06.
- Original EngineeringThermalSnapshotAdapter_v0_1_0.js Git blob 2ac2657c9f89957010df5e960514151e9f3575c9, verbatim body plus ESM export and imports of four pure functions extracted exactly from EngineeringThermalPassportService_v0_1_0.js blob ac4b82ff6b615e4e6c0557284f05039edbb6e6e8.
- Original EngineeringRoomNetMetricsService_v0_2_7.js pure function span blob d5eabecc60a82c988ad3b5999980ad0499fc10f7, with a strict four-point rectangular normalization shim for its legacy dependencies.
- Already deployed original EngineeringHeatLossEngine_v0_1_0.js blob bc66bff2948618aa9f97cfca510cd52cae960b63.
- No new external OSS or dependencies.
INPUT: Two diagonal corners on 12m canvas with 250mm snapping; explicit thickness 40–600mm, room name, four wall roles with no assumed external state, window/door widths/heights/offsets, temperature/U/ACH/factor/reserve, explicit floor/ceiling boundary (ground W must be independently validated).
PROJECTION: Floor, room, zone, walls and openings in mm with draft-only stable IDs. Legacy adapter subtracts opening areas and derives thermal passport, net area/volume; unchanged heat engine calculates W and per-component breakdown. Incomplete/untrusted inputs do not produce silent complete results.
SCOPE: new source ESM adapters and functional edit/import/export UI plus CSS/Node tests; scoped app page and static whitelist. No SQL, migrations, server mutation routes, Google writers or PROD.
LIMITATIONS: One rectangular room per draft, at most one opening per wall; no shared-room topology/concave polygons, real project crosswalk, multi-room thermal batches, UFH routing or price estimates. On-device draft is in memory: JSON export is required for explicit persistence; not equivalent to PostgreSQL backup.
TESTS: 5×4m, 100mm walls -> 20m² centerline, 19.11m² net, 47.775m³ at 2.5m height. One 2×1m window subtracts 2m² from walls. Tin20/Tout−10, U wall0.4/window1.6, ACH0.5, factor0.34, reserve10% gives ~941.22W. Invalid shapes and openings, missing U/climate, wrong source IDs and script injection rejected.
MIGRATION: none for P1. Saved real legacy project integration requires separately accepted stable-ID mapping, approved migration, current backup, rollback; draft H2 PR #1181 is manual-only save and does not establish a drawing source of truth.
ROLLBACK: Existing Clean H1 exact commit 9646ff8c1c3db8e24b6d6d53d67389d511af4fee, Render dep-dbljqms9v7es73a7l56g, no DB recovery needed.
REPAIR_LIMIT: maximum two evidence-led fixes.
UNRESOLVED: Authentic Google Engineering drawing import/persistence and full editing needs explicit source data access and authority mapping. Do not claim it is already transferred.


## P2 — connected rooms, shared physical walls, whole-floor derived thermal (2026-11-04)

CAPABILITY_ID: VBOS_CLEAN_CONNECTED_RECT_FLOOR_THERMAL_P2
WORKFLOW_MODE: IMPLEMENT_FEATURE
USER_RESULT: Construct a real small multiroom floor from individually drawn and validated rectangle rooms; recognize fully coincident wall centerline spans as ONE shared physical wall with two room links; aggregate genuine per-room thermal estimates into whole-floor W only when every room has enough data.
BASE_COMMIT: f0e897b05f66de1197f6f591c532f8613de90f41
OWNER_BRANCH: feature/vbos-clean-eng-floor-connected-p2-20261104
TARGET: isolated Clean PWA candidate → GitHub CI → exact existing Render TEST if release gate is clear. No PROD/Google source updates.
RISK: L2 client-only derived calculations and in-memory geometry. No data schema, migration or canonical writer changes.
CANONICAL: Legacy Engineering project/floor/room identities remain unchanged and NOT mapped to these CLEAN-DRAFT records; this is not a production crosswalk. H2 persisted manual calculations PR #1181 stays DRAFT and is not folded into this P2.
SCOPE: new floor graph model and UI, client input/selection/export import, shared wall topology verification and room wall links based on exact fully matching edges, original pinned VBOS ThermalSnapshotAdapter and HeatLossEngine, tests, static file whitelist; existing P1 single-room editor remains available.
RULES: One physical shared-wall ID assigned across two exact matching edges; wall thickness must match. Interior overlaps, partial edge overlaps, nonconnected floors and 3+ owners fail closed, never guessed. Shared wall is classified heated-adjacent ONLY for equal indoor temperatures; differing indoor design temperatures are blocked pending true inter-room thermal-transfer modeling. Openings on shared walls are blocked (ownership and transit source unresolved). Outer wall roles must be explicit. At most 12 rooms, 12×12m canvas, P1 original geometry remains rectangle-only.
TEMPERATURES: Indoor/outdoor/U/air changes/air heat factor/reserve and floor/ceiling boundary types are explicit per room, not inferred from drawings. Missing fields mean INCOMPLETE and null entire-floor total, never silent partial-result success.
SOURCE: P1 ESM source ports use original legacy commit 5a2621c84d285708036c6d5dadd435f5bc3d7e06, ThermalSnapshotAdapter blob 2ac2657c9f89957010df5e960514151e9f3575c9, net area blob d5eabecc60a82c988ad3b5999980ad0499fc10f7, HeatLoss blob bc66bff2948618aa9f97cfca510cd52cae960b63. This P2 adds VBOS-specific floor topology adapter only; no external OSS dependencies.
TEST_EVIDENCE_REQUIREMENTS: 2 adjacent 5×4m rooms at 100mm thickness; net 19.11m² each, one shared wall / 7 physical vs 8 raw walls; P1 single-room source parity; original heat engine W per room, no duplicated shared-wall heat and valid whole-floor total; reject overlaps and partial shared walls; reject openings on common wall, unequal thickness, unequal room temperatures, disconnected floor, invalid legacy import IDs. Source & Node tests + disposable PG existing E2E, exact runtime postflight and owner mobile interaction.
FILES: new public/engineering-floor-model.mjs, public/engineering-floor-ui.mjs, public/engineering-floor.css, tests/engineering-floor.test.mjs; existing public/app.js, public/index.html, server.mjs, package.json and this README. No changes to SQL or api/action.
ROLLBACK: exact prior H1/P1 working source f0e897b05f66de1197f6f591c532f8613de90f41 and Render dep-dblklb15efls73e1sdh0. Code-only revert, preserving unchanged database. In-memory floor must be explicitly JSON-exported before reload/log out.
NOT_SCOPE: arbitrary polygons or partial shared walls, door passage on shared walls, normalized thermal transfer between unequal-temperature spaces, existing Google Engineering snapshot migration, price calculation, UFH routing, separate persistent CRUD, official norm certification.
STOP CONDITIONS: migration/source ownership/business crosswalk required, topology unsupported, CI fails twice, shared TEST lane changed or infrastructure data risk. No extra Codex/paid APIs.
