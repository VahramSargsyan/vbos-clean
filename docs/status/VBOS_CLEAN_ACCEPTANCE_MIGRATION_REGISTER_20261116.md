# VBOS Clean — Capability acceptance and migration register
Evidence checkpoint: 2026-11-16. Owner: Vahram. Mode: AUDIT_ONLY for capability inventory; PATCH_FIX for the separate standalone-test-fixtures block. This is a **status register**, not a replacement Build Packet or migration approval.

## Authorities and evidence hierarchy

- GitHub accepted source: `VahramSargsyan/vbos-clean/main` at exact commit `1cf42345b35ce15f397c5fb1bd59821d5df8f7dc`.
- Hosted Clean TEST: https://vbos-clean-mvp-2026.onrender.com/ — Render service `srv-dbkvfh2jnfac73a31nv0`, deploy `dep-dbtbjat6e07s73c0i9k0` **LIVE** at this exact SHA, autoDeploy OFF. Existing Google legacy/PROD remain separate.
- Canonical Clean TEST database: Neon `proud-hat-90291191`, branch `br-crimson-hat-b9kwg7n6`, database `vbos_mvp_clean`. Read-only SQL evidence obtained 2026-11-16. No DDL or row mutation in this inventory.
- Source-switch receipt: https://github.com/VahramSargsyan/vbos-clean/issues/2 . Owner's `Все ок` on 2026-11-16 accepted **existing login, display and preservation smoke-check**, not every CRUD scenario or any finance authority cutover.
- Historic implementation contracts are the existing individual README Build Packets. They are frequently labeled candidate/NOT_RUN at the time of authoring; **later inclusion in the current code tree does not silently make those original gate claims PASS**.
- 530 tests PASS in the earlier exact-source Cloud Browser checkout **with six old-repository legacy source references supplied**. A completely independent test run was not proven. See the separate bounded source-only test repair.

### State definitions

- **ACCEPTED_SCOPE**: owner accepted the exact defined TEST release/smoke-check. Not PROD or complete original-app parity.
- **DEPLOYED_NEEDS_FLOW_ACCEPTANCE**: code and routes included in installed commit, DB tables seen, but focused authenticated save/reload/negative UX was not independently accepted.
- **HISTORICAL_STAGED**: preserved source/archive facts; not automatically canonical writable entities or verified latest Google snapshot.
- **BUSINESS_BLOCKED**: technical parts available but prohibited money/authority action or owner decision pending.
- **DEMO_ONLY**: source and UI exist but no verified real-data/live legacy engineering integration.
- **TECH_DEBT**: infrastructure/test issue unrelated to business capability.

## Register — functional scope

| Capability | Currently installed/evidenced | Exact status | Minimum remaining closure |
|---|---|---|---|
| Independent Clean source, owner login, Render and PostgreSQL | Exact main/runtime source, authenticated existing login, static files, startup PostgreSQL transaction/rollback, 96/96 pre/post DB table fingerprints in release receipt | **ACCEPTED_SCOPE** (source-switch + existing-owner smoke only) | No reacceptance of the GitHub move needed; do not infer general PROD |
| CRM Clients / Leads / Objects / Orders CRUD and search | Routes and UI in `server.mjs`, `public/app.js`; native TEST: 19 Clients, 6 Leads, 20 Objects, 5 Orders | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | Create or edit one TEST Lead, convert/link to Client, open Object + Order and verify exact IDs after refresh, without touching real financial records |
| CRM contacts / reminders / Win Score / lead transfer and history | CRM modules and guarded endpoints installed; 2 native CRM interactions, 2 exact lead-client links; old interactions archive separately has 30 rows | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | Validate contact save, next action/Calendar readback, transfer behavior where relevant; score is a signal, never promised probability. Do not infer legacy links by name/phone |
| Client portfolio / Object and Order interaction journal / object-worklog relation | Source files, endpoints and additive schema present; 0 Object and 0 Order journal entries | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | One safe TEST journal write/readback; verify correct parent; no automatic Finance side effect |
| My Work / WorkDay / A1 / presence / WorkLogs / sessions | UI + guarded writers installed; native DB has 2 WorkDays, 2 WorkLogs, 2 sessions, 2 A1, 1 presence entry | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | Open a TEST workday, record WorkLog, close/reopen and verify persistence/guards; no inferred worker attendance or money from owner logs |
| Schedule / automatic Order plans / Capacity Finder / Calendar / conflict warnings | Plan and capacity modules installed; 7 manual schedules and 1 automatic Order schedule | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | Schedule a TEST slot, test conflict warning, refresh and verify exact date/order link; capacity suggestions are non-booking previews |
| Worker roster / assignments / WorkerDay / WorkerTasks | Modules and tables present; 2 native workers, 0 WorkerDays and 0 WorkerTasks | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | Safe synthetic worker/day/task lifecycle and reload; not a payroll system |
| WorkBenchmarks | 22 original historical proposals exist in TEST, **0 approved benchmarks**, no WorkerTask observations yet | **BUSINESS_BLOCKED** for approved-rate policy | Owner approval/revocation for actual benchmark values in TEST; never infer approval from imported PROVISIONAL rates |
| Estimator / plumbing calculator / persisted Estimate | Source and owner routes installed; 1 native Estimate, estimator legacy-calculation UI, quote overrides and three-stage wizard | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | Calculation → Lead-bound saved draft → refresh/reopen, confirm totals and preservation; no invoice implied |
| Estimator Cards and Pricebook | `estimator-cards.mjs`, `estimator-pricebook.mjs`, SQL 0035/0036 tables and routes installed; **0 user cards, 0 tariff profiles, 0 price rules** | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** | Create one owner card/recipe, one tariff/price rule, refresh/reopen and verify precedence; separate from global legacy service-price authority |
| Services + MasterPrices legacy reference | 37 read-only Services and 1 MasterPrice-reference row; matching code installed | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE** for current reference UI | Confirm selection/reference presentation; do not interpret legacy prices as verified current market prices |
| Historical CRM / Orders / Finance archive | 131 `mvp_history.source_records`: CLIENT 17, CLIENT_ASSESSMENT 13, FINANCE_TRANSACTION 24, LEAD 33, OBJECT 19, WORKER 2, WORKER_ASSIGNMENT 1, WORK_ORDER 22. Separately 30 old CRM Interactions and 2 old LeadTransfers; 5 native Masters | **HISTORICAL_STAGED** | One import batch currently state STAGED; verify snapshot freshness/coverage, stable IDs and source→native mapping before declaring historical migration COMPLETE. Archive rows do not count as native writable CRM rows |
| Finance historical reports / order, object and worker results / capital previews | Read-only Finance modules, archived 24 FinanceTransactions, initial fund/cash evidence present | **DEPLOYED_NEEDS_FLOW_ACCEPTANCE**, historic-only | Owner read-only report interpretation and source coverage; do not conflate historical 24 with new native ledger |
| Finance/Capital native owner writer & authority cutover | `mvp_finance_native` has 8 fund openings and 8 funds; **0 native transactions**. Cutover row: `phase=BLOCKED`, `financial_write_authority=GOOGLE`, no date, ownerIdentity=false, GoogleFrozen=false, activated=false | **BUSINESS_BLOCKED** / writer NOT ACTIVE | Independent signed as-of closure, owner financial decision, exact reconciled opening balances and IDs, backup/rehearsal, authenticated POST and reversal E2E and exact TEST approval before any cutover |
| Engineering geometry / thermal / radiator | Synthetic planning and demonstration source included; `domains/engineering/README.md` says no verified current Engineering source/DB integration | **DEMO_ONLY** | Exact-source real project crosswalk, measured geometry/thermal/runtime validation, migration plan and separate user acceptance |

## Test repair / separate technical checkpoint

Six legacy original files were used by 12 source parity tests: `CapitalService.js`, `CrmService.js`, `Config.js`, `EstimatorUi_v1_5_0.html`, `EstimatorCalculationFlowPatch_v1_5_0.html` and `EstimatorResultCardsMaterialsPatch_v1_5_6.html`.
The bounded fix stores verified narrow source evidence under `tests/fixtures/legacy/` (exact original Capital functions, verbatim matched lines elsewhere, original Git blob SHA/commit) and moves only test references to local fixtures. The runtime, SQL and real data are unchanged. Historical markers are **pinned**, not automatically revalidated against a changing legacy repository. The `verify:source` guard rejects relative literal file references outside the checkout.

**Evidence gate for THIS candidate:** check each legacy fixture against the exact old source, 12/12 test reference paths, source guard syntax/static behavior and correct original function extraction. Full standalone `npm test`, disposable PostgreSQL E2E and hosted Android are separate checks; do not call them PASS until actually run. GH Actions held to conserve owner budget.

## Practical order for subsequent migrations (not permission to execute them)

1. Complete standalone test candidate verification without relying on GitHub Actions. Record any checks that cannot execute as NOT_RUN; do not rewrite invariant expectations just to turn red tests green.
2. One bounded **four-flow owner acceptance** on the existing TEST: CRM→Order, WorkDay→WorkLog, Calendar→Plan, Estimator→Cards/Prices. Test new actions only with clearly disposable data and approved semantic scope.
3. Freeze/reconcile historical data import coverage and exact legacy/native ID bridges; reuse existing 131 rows, 30 interactions and 2 transfers instead of blindly re-importing.
4. Benchmarks: ask for owner approval of 22 proposals only after trustworthy source and owner action UI verification. No payroll authority inferred.
5. Finance/Capital: owner decides signed source cutover and opening business facts; only after backup, no dual-writer gate and exact postflight may finance move from GOOGLE to POSTGRES. Never treat this status register as a Finance release order.
6. Engineering real projects and calculator parity remain a distinct product migration, not part of finance cutover.

**Protected invariants:** leave old VBOS, Google, Render TEST, the occupied Neon database and PROD unchanged in this documentation/test-only block. No new servers, schema migrations, public customer exports, Codex, paid API or GitHub Actions runs. Current test release remains `1cf42345b35ce15f397c5fb1bd59821d5df8f7dc`.

**Rollback:** revert only this documentation and test-fixture candidate branch/PR; data rollback NOT_APPLICABLE. Files for owner to copy: none.
