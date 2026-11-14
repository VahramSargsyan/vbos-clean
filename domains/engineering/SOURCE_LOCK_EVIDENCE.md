# VBOS Clean PWA — Engineering source identity evidence (2026-11-04)

STATUS: SOURCE_TUPLE_DISCOVERY_ONLY / ENGINEERING_CORE_STABLE_NOT_VERIFIED
WORKFLOW_MODE: NEW_APP_DISCOVERY / AUDIT_ONLY; isolated source contract extension only.
BASE_MAIN: e3dcfa6649bd17b076e2e881b4b7ce7df4cd0ec2
PWA_BASE: 9f3a9ee83d747b447a38aea45995bedd10b2b0cf
ENGINEERING_CONTRACT_PARENT: 9e698808d822e7aee2a4a70ad4df081ed9553620
RISK_CLASS: L1 (standalone read-only schema/provenance gate); runtime migration is separately L3.

## Exact checked Git source evidence

| Source | Exact source commit | Schema file | Git blob SHA | Declared exclusionTypes | Classification |
|---|---|---|---|---|---|
| UFH TEST_CRM_RELEASE.json | ce72ffdcd1d0eaa04113bcb32f9b4b6065be39f9 | EngineeringSchema_v0_9_1.js | 49afa9d7a557ec4f493925b9895810dd2085d1f7 | FURNITURE | Pinned TEST source, not PWA acceptance |
| Engineering Core TEST_ENGINEERING_RELEASE.json | 4e79c5d8663fe1a80a42cb1adfcf37576b234dab | EngineeringSchema_v0_9_1.js | 49afa9d7a557ec4f493925b9895810dd2085d1f7 | FURNITURE | Pinned TEST; ownerLane says UFH, registry says Engineering Core |
| AutoRouting TEST_ESTIMATOR_RELEASE.json | 567a5be66865b9aceba8c1e964a44c2b9be7f499 | EngineeringSchema_v1_0_0.js | 65f08c626accdf8a21e94189cb65080378c03868 | FURNITURE | Pinned TEST source, not overall Engineering migration authority |
| UFH working branch feature/engineering-ufh-dual-v1 | 0aebcdfe2c44219a8a5941c1c0f3388926d48ca1 | EngineeringSchema_v0_9_1.js | a284f7728e637ed7df6c66a903bb54f738387760 | FURNITURE, NO_HEAT | In-progress branch; not equivalent to pinned TEST |

**Critical:** identical name and declared `version: v0.9.1` correspond to two different file blobs with changed `exclusionTypes`. Do not infer monotonic schema compatibility from v0.9.1 versus v1.0.0 either: the AutoRouting candidate contains roof geometry entities, whereas the UFH working branch declares `NO_HEAT`. A unified accepted geometry authority and migrations are not established.

All Git blob SHAs were read from GitHub `fetch_file` at the cited exact commits/branches. No live Google Sheet schema or Apps Script deployed file pull-back was checked in this block.

## Safe source contract extension

Version `VBOS_ENGINEERING_SNAPSHOT_V2_DRAFT` adds:
- source.schemaBlobSha: exact 40-character Git blob SHA of the chosen Engineering schema file;
- strict `verifyEngineeringSourceLock(snapshot, trustedLock)` three-field check (commit SHA, schema blob SHA, schema version);
- fingerprint includes all three fields and the revision;
- explicit failures for missing hash, missing trusted lock, source mismatch.

The trusted lock is a **separate server/config/verified manifest input**, never the frontend request itself; this standalone module does not fetch GitHub or register any accepted sources. A correctly formatted 40-hex SHA is not evidence of the deployed source without independent commit-to-blob verification. No source is implicitly accepted just because it appears in this evidence table. Do not use the tuple gate to certify UFH coverage, manifold continuity, thermal physics or engineering schema migration readiness.

## IDs and semantics

The observed schema declares `EngineeringProject: ENG`, `EngineeringFloor: EFL`, `EngineeringRoom: ERM`, `EngineeringRoomZone: ERZ`, `EngineeringExclusionZone: EXZ`. The PWA business `mvp_objects.id` is an independent PostgreSQL UUID; `objectLink` remains optional and read-only. The snapshot room `boundary` is a geometry projection, not direct canonical EngineeringRoom storage: actual polygon data resides in EngineeringRoomZones.verticesJson with explicit engineeringRoomId/engineeringFloorId/engineeringProjectId relations. Future mapping must validate those relations and source revisions without relying on Sheet row position. Active heated area also depends on FURNITURE/NO_HEAT and NO_ACCESS semantics, wall thickness and geometry union; this draft projection cannot compute it.

## Required gates before runtime integration

1. Resolve active Engineering feature ownership and exact accepted source/schema/manifest identity, including the TEST_ENGINEERING ownerLane inconsistency. Do NOT edit another lane.
2. Freeze a compatible scope or owner-authorized read-only preview subset. Do not assume the newest schema version is a superset.
3. Decide whether `NO_HEAT` is canonical in the accepted baseline; account separately for `FURNITURE` and `NO_ACCESS`.
4. Produce an exact legacy rows-to-projection adapter only against that frozen schema and original fixture data, with strict parent ID crosswalk and revision checks.
5. Verify declared third-party license notices/dependencies for any engine actually brought into Node runtime.
6. Separate L3 PostgreSQL Engineering persistence, migrations, real authentication and TEST browser acceptance from this read-only source contract.

## Reproducible verification and rollback

`node --check devtools/vbos-mvp-clean/domains/engineering/contract.mjs`
`node --test devtools/vbos-mvp-clean/domains/engineering/contract.test.mjs`

Expected: 18/18 deterministic local tests PASS, including source identity negative cases. Test fixtures are synthetic; exact sample SHA used in the tests is not a runtime attestation.

MIGRATION_REQUIRED: NO. FILES_TO_DEPLOY/COPY: NONE.
ROLLBACK: reset/discard this isolated contract branch; shared PWA runtime remains unchanged.
NOT_RUN: GitHub repository CI for this candidate, hosted TEST, exact Apps Script source pullback, PostgreSQL engineering import or SQL, browser/API auth, owner acceptance, production calculations.
STOP: source identity cannot be elevated to migration-ready or accepted production without owner-approved frozen baseline and runtime evidence.
