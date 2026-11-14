# VBOS Clean — AI maintainer entrypoint

Status: standalone source repository. Adopt universal governance v1.1.0 on main before treating it as active.
Read CODEX_USER_GATE.md, PROJECT_GOVERNANCE.md, docs/governance/VAHRAM_APP_UNIVERSAL_GOVERNANCE_v1.1.0.md and docs/governance/BOUNDED_CHAT_WORK_CONTRACT_v1.1.0.md before material work. Extend the existing README Build Packets, not a parallel requirements system.

This is an EXISTING PostgreSQL/Node.js Clean application. Never rebuild it to solve a GitHub/Render deployment problem. Existing legacy VBOS in VahramSargsyan/vbos-app is a separate system.
- Source authority: this repository's accepted main; feature work on bounded branches; PR and verified TEST before main for runtime changes.
- Current accepted extraction baseline: 67a0fe2fabec014160ed90aa876880a67a7b0046, copied byte-identical from old Clean source e17643a0c399d859abe85c4057a7ec732ac25526.
- Existing Render Clean TEST is still connected to the old repository. DO NOT silently redeploy, change its repository, change its start/build commands, change its environment variables, or modify the shared Neon databases.
- Tests: npm run verify:source (layout only); npm test (unit/UI); npm run test:e2e with a separately authorized disposable PostgreSQL TEST_DATABASE_URL; then exact-commit hosted runtime and authenticated acceptance. Report NOT_RUN accurately.
- No GitHub Actions job creation or triggering while the owner is conserving Actions minutes; lack of Actions does not waive runtime gates.
- Keep owner/auth, real data, IDs, finance authority, snapshots, historical migrations and source-of-truth rules intact. No direct PROD writes. No additional service/paid spend without approval.
- Do not commit .env, credentials, cookies, connection strings, tokens, customer records or backup exports. Repository currently PUBLIC; treat all commits as publicly visible.
- Existing CodeX gate stays disabled unless the user explicitly requests Codex for that task. API budget is 0.
- A feature/main merge is not PROD approval. Stop if the sole path needs unsafe secret transfer or occupied TEST repointing; document exact blocker.
