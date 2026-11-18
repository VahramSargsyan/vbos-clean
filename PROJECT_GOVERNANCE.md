# VBOS Clean project governance — local overlay

Canonical baseline: docs/governance/VAHRAM_APP_UNIVERSAL_GOVERNANCE_v1.1.0.md (adopted on main through PR #1).
Bounded work contract: docs/governance/BOUNDED_CHAT_WORK_CONTRACT_v1.1.0.md.
Local Codex control: CODEX_USER_GATE.md (disabled by default).

PROFILE: STABLE_MAIN. Source code for Clean resides at repository root; historical paths inside imported README records are not live deployment instructions.
- MAIN = stable, accepted Clean source; experimental feature branches are not deployment authority for PROD.
- CLEAN TEST = existing Render service srv-dbkvfh2jnfac73a31nv0, URL https://vbos-clean-mvp-2026.onrender.com/, connected to vbos-clean/main at exact accepted TEST source 1cf42345b35ce15f397c5fb1bd59821d5df8f7dc, dep-dbtbjat6e07s73c0i9k0 (owner smoke accepted).
- CLEAN INTEGRATION/STAGING = NOT REGISTERED for this independent repo. Old Apps Script STAGING is a different application; do not reuse it.
- NEON TEST = vbos_mvp_clean is the occupied Clean database. vbos_clean_staging_20261114 is a separate empty database, but not a verified hosted application. Neither is PROD.
- PROD = separate release gate and owner authorization, backup, exact-source verification, migration and rollback.

For each complete block: extend the relevant existing README Build Packet with scope, source commit, owner, TEST, risk, migrations, verification, rollback and STOP. First use npm run verify:source; then available npm test and isolated PostgreSQL E2E; then guarded exact-source deployment, readback and owner mobile acceptance.
Don't conflate static checks with runtime tests. Don't mutate a database just to make a source-repository split pass. Retain existing service and credentials until rollback is tested.
No GitHub Actions runs until the owner restores that budget. Use read-only and non-Actions verification; if required tests cannot be executed, mark the block BLOCKED/NOT_RUN, not accepted.

## L1 presentation-only fast lane (owner-requested)

This is a **bounded, project-specific delivery-profile proposal** requested by the owner on 2026-11-18. It applies **only after this governance change is accepted in `main`** and only as permitted by the adopted universal governance's explicit profile-change process. A candidate governance PR never changes the currently effective rules.

**Qualifying corrections (L1):**
- Presentation-only edits to `public/*.html`, `public/*.css`, plus directly affected UI tests and documentation.
- Reorder/reposition existing buttons and navigation groups **only when** all route IDs (`data-tab`), stable element IDs, event handlers, authorization, form semantics, focus/keyboard behavior and underlying data/API contracts are preserved.
- Changes to colors, typography, spacing, sizes, simple responsive layout and placement of an existing theme control.
- No JS/TS, server code, database/schema, secrets, persisted state, permissions, data writes or feature behavior modifications. A new action, removed destination, changed `href`/`data-tab`, accessibility regression, or nonvisual effect disqualifies the patch.

**Scoped faster delivery, if adopted:** For a qualifying L1 correction, allow a reviewed PR to merge into Clean `main` **after source-accurate visual preview accepted by the owner** plus scoped deterministic DOM/CSS tests and a clean exact-source diff, **without requiring the pre-merge hosted Render TEST cycle** used for full features. This is an explicit exception to the *ordering* of the Clean STABLE_MAIN feature-delivery workflow; it does not declare the new code hosted-tested. The test/acceptance receipt must distinguish `DESIGN_ACCEPTED` and `CI_VALIDATED` from `TEST_RUNTIME_VERIFIED`. If the preview is only a schematic rather than source-accurate, separately verify changed markup/style in a real browser before this exception can apply.

**After such a merge:** Existing Render TEST may be deployed from `main` only with an exact main SHA, current baseline/deployment checked immediately beforehand, a code-only rollback prepared, no other session overwritten, and guarded hosted smoke/readback. A merged UI correction is not PROD approval, a database migration, or proof that real mobile interactions work. If a hosted check fails, revert the exact UI patch and restore verified working source; leave owner data intact. The normal PROD gate remains separate.

**Disqualifiers / stop:** Any ambiguity about navigation/auth/runtime, missing focused checks, concurrent `main` movement, occupied TEST, unverified rollback, or material schema/business change returns to the normal STABLE_MAIN branch → TEST → acceptance → main process. No Codex, recurring Actions, paid API, new service or PROD actions are authorized by this text.

**Compatibility gate:** The canonical universal governance v1.1.0 still governs release invariants and controls conflicting interpretations. Adoption of this local profile requires explicit governance review confirming its compatibility with the canonical named-profile-change mechanism; if it conflicts, the exception is **not operative** until that conflict is resolved through separately accepted governance changes.
