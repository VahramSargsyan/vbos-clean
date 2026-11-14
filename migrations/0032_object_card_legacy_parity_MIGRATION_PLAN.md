# OBJECT_CARD_LEGACY_PARITY_BATCH2 — MIGRATION_PLAN (CANDIDATE ONLY)

CAPABILITY_ID: VBOS_CLEAN_OBJECT_CARD_LEGACY_PARITY_BATCH2
MODE: IMPLEMENT_FEATURE, source-only TEST preparation
RISK: L3, additive persisted schema
OWNER: Vahram / current ChatGPT assistant
BASE: 5659c4641ad34288cd778902c694679f0756e2a4 (PR #1274 / previous source-only batch)
TARGET: existing isolated Clean Render TEST `srv-dbkvfh2jnfac73a31nv0`, after owner approves one combined release.
NO DEPLOY / NO MAIN MERGE / NO WORKING NEON SQL / NO PROD.

## Exact legacy contract
Old `ObjectService.js saveObjectService_` persists `objectType` as text (max 100).
Old `CrmService.js addInteractionService_` accepts `Object`, creates an
append-only active interaction with kind, summary<=1000, nextAction<=500,
nextActionAt as optional datetime-local, notes<=5000 and stable parent Object ID.
Old `Scripts.html renderObjectCard` displays a scoped contact journal and
`+ Контакт` action. This candidate reproduces those fields/behaviors on
native Clean objects only, without reusing Client/Lead interactions or inventing history.

## Source / intended SQL / compatibility
- PostgreSQL `public.mvp_objects.object_type` additive NOT NULL DEFAULT '' <=100.
- PostgreSQL `public.mvp_object_interactions` new append-only separate table
  with exact Object FK and idempotent request_key/hash. Scope is solely
  `public.mvp_objects` (no client/lead contact inference).
- Existing Client/Lead `mvp_crm_interactions` unchanged; no rewritten CHECKs.
- Existing object UUID, client ID, order bindings, xmin row-version update
  and all status enums remain unchanged.
- Old imported Google contact history remains a separate immutable source.
- Date/time: `next_action_at` stores exact local wall-clock accepted by legacy
  datetime-local; no automatic time-zone conversion and no implicit reminder.

## Mandatory gate BEFORE any real TEST application
1. Confirm exact candidate commit, lane owner, and all other active Clean
   feature threads; no same-branch concurrent schema operations.
2. Run exact SQL twice using disposable PostgreSQL CI; verify existing object/
   order/client counts and IDs unchanged, row_version edit concurrency still holds,
   Object-contact parent isolation, auth, duplicate-request and cursor checks.
3. Create independently recoverable isolated Neon TEST backup/snapshot, read back
   its identifier/time and existing object/contact counts. Never delete earlier backup.
4. Only with separate authorized TEST schema deployment, apply exact migration
   through official Neon mechanism; verify column constraints, table/index,
   sample update/create/read, and before/after existing rows.
5. Pin exact fully tested combined commit to Render TEST once; no auto deploy,
   verify deployed SHA/readback then one Android owner acceptance.

## Rollback
- Source only: return to exact pre-Batch2 commit without touching Neon.
- After additive TEST application: rollback runtime to compatible prior source.
  Retain added column/table to preserve legitimate new data; no DROP/restore of
  later owner-entered records. With zero new data, reverse schema only under a
  separate authorized TEST recovery plan after backup/readback.
- Stop if migration cannot be rehearsed twice, existing schema differs, backup
  unavailable, live state conflict, or data migration/cutover would be needed.

NOT_RUN until actual combined deployment: hosted runtime / Android acceptance,
working Neon schema migration, historical Google contact migration and PROD.
