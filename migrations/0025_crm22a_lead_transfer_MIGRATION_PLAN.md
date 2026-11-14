# CRM-22A Manual Lead Transfer — TEST-only Migration / Rollback Plan (2026-11-08)

## Gate / Scope

- Applied to **Neon Clean TEST** `proud-hat-90291191/br-crimson-hat-b9kwg7n6/vbos_mvp_clean` **ONLY** after exact approved GitHub source and successful disposable PostgreSQL E2E.
- Source: `CrmService.js transferLeadService_` and `Config.js VBOS_ENUMS.leadTransferReason`. No legacy Google writes, no exported Masters imported, no WorkLogs/Finance/Calendar migrations.
- New `mvp_crm_lead_transfers`: one immutable record per Lead with request key, canonical reason and manual recipient, recorded at DB transaction time. Existing Lead status CHECK extended to `transferred`; no existing status rewritten or ID changed.
- **Preflight:** verify schema `mvp_leads_status_check` still only permits `new/contacted/qualified/won/lost`; no transfer table; row counts and exact fingerprints (all existing Clients/Leads/Objects/Orders/Estimates/associations). Verify branch/state/source commits. Source code E2E must pass with this SQL replayed twice.
- **Backup:** create a *fresh point-in-time branch from current TEST main*, independent from older CRM15/16 backups; perform read-only counts and fingerprints against live parent and branch, require exact equality before DDL. Free Neon plan currently **10/10 branches** (2026-11-08); do not delete old branches, use an old backup, or bypass this gate without owner's exact additional authorization.
- **Apply:** single explicit Neon transaction on TEST `SET LOCAL lock_timeout='5s'`, `SET LOCAL statement_timeout='45s'`, apply exact `0025_crm22a_lead_transfer_TEST_ONLY.sql` as immutable reviewed Git blob. DDL is additive except replacement of the named Lead CHECK constraint; existing permissible values remain valid.
- **Postflight:** read back `pg_get_constraintdef`, transfer table and unique indices, old Lead/client/object/order and estimate/relations counts/fingerprints; require unchanged rows, zero pre-existing transfers, no conflict with existing CRM01 conversion. Deploy exact CI source tree into Render Clean TEST only AFTER schema PASS.
- **Runtime:** verify exact Render deploy SHA LIVE, logs `VBOS CLEAN MVP STARTED` and PostgreSQL readback rollback; verify that no records were modified by deployment. Synthetic writes were already done in disposable PostgreSQL E2E, not live TEST.

## Rollback / Preservation

- If DDL transaction fails, transaction rollback should leave previous schema and rows intact; independently re-read.
- If new code deployment fails, redeploy exact preceding TEST `5a33cd22e6f2b0eb0943c8ba5a8819de8b42feec` / `dep-dbo94bc9v7es73ek7nk0`. Extended Lead CHECK/table remain harmless for old code: **do not drop the table containing user transfer history**.
- Full DB restore from newly created Neon branch requires a new explicit owner approval **after** assessing any later legitimate TEST edits. Do not restore a pre-CRM22 snapshot automatically, and do not revert `transferred` CHECK if any Lead has that status.
- Migration reversal can safely be considered only after zero transferred Leads, zero transfer records, no pending traffic and owner permission; otherwise use forward repair. Never change PROD direct.
- **Owner acceptance:** manually transfer a new TEST-only Lead, verify confirmation, status and one immutable history, repeat attempt blocked; no automatic transfer to worker.
- **BLOCKED if 10/10 Neon branches remain and no fresh branch can be created.** Implementation/CI PR may be complete, but **TEST SQL/Render release stays NOT_RUN**. This is not permission to delete any old backup.
