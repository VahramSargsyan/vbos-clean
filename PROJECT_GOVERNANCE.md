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
