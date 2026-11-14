# VAHRAM APP UNIVERSAL GOVERNANCE v1.1.0

Status: CANONICAL UNIVERSAL DEVELOPMENT RULESET
Scope: all active Vahram APP / Google Sheets / Apps Script / GitHub / data / strategy / migration projects unless a project-specific rule is stricter.

## 1. Core operating principle

~~~text
UNDERSTAND CURRENT SYSTEM
→ DEFINE BOUNDED RESULT
→ PROTECT CANONICAL DATA
→ MAKE MINIMAL SAFE CHANGE
→ VERIFY AT THE REAL TEST LEVEL
→ PROMOTE EXACT TESTED SOURCE
→ OBSERVE REAL USE
~~~

Optimize for accepted useful functionality without weakening correctness, safety, rollback or evidence.

## 2. Mandatory workflow mode

Select one primary mode before changes:

| Mode | Permitted scope |
|---|---|
| AUDIT_ONLY | Read, analyze and report; no fixes |
| STRESS_TEST_ONLY | Authorized tests on safe copies; no fixes or unapproved destructive writes |
| DIAGNOSTIC_ONLY | Read-only diagnosis; no runtime edits |
| PATCH_FIX | Fix the stated defect, including explicitly requested diagnostic instrumentation |
| IMPLEMENT_FEATURE | Implement one approved capability in an existing product |
| BUILD_NEW_APP | Build after product discovery/blueprint |
| ECOSYSTEM_PLANNING | Product/architecture planning; no implicit runtime implementation |
| PRODUCTION_OBSERVATION | Observe and classify; no automatic fixes |
| FULL_REBUILD_ALLOWED | Rebuild only with explicit current permission |

NEW_APP_DISCOVERY is a planning phase of ECOSYSTEM_PLANNING, not an undocumented additional mode. DIAGNOSTIC_PATCH is a PATCH_FIX subtype and requires an edit request. Never interpret 'why is it slow?' as permission to insert code. A request to fix authorizes necessary diagnosis and in-scope repairs; it does not require a separate approval for each ordinary internal step. Materially changed scope requires reclassification and authorization when needed.

## 3. Universal P0 legacy and source-of-truth protection

1. Understand current runtime/data model before changing it.
2. Do not rewrite a working legacy application from scratch without explicit permission.
3. Do not delete working behavior merely because a cleaner architecture exists.
4. Preserve stable IDs, canonical relations, stored statuses and runtime contracts unless migration is explicitly planned.
5. Repository/runtime authority beats historical roadmap text when determining what currently exists.
6. Canonical data remains source of truth; indexes, caches, dashboards and derived analytics are secondary.
7. Failed operations must not leave canonical records partially corrupted.
8. Unknown state is not permission to guess; inspect the smallest authoritative source needed.
9. Never claim a stronger verification level than was actually executed.
10. Never commit secrets, credentials, private keys, OAuth state, Script Properties or sensitive exports.

## 4. Documentation-first / Definition of Ready

Before a major feature, module, shared infrastructure change, architecture change, cross-module integration or schema/data-contract change, define:

~~~text
CAPABILITY_ID
USER_RESULT
CANONICAL_SOURCE_OF_TRUTH
SCOPE
OUT_OF_SCOPE
FILES / MODULES
DO_NOT_TOUCH
DEPENDENCIES
SHARED_HOTSPOTS
SCHEMA / ID / RELATION IMPACT
MIGRATION_PLAN
RISK_CLASS
ACCEPTANCE
ROLLBACK
PROMOTION_PATH
FRESHNESS_FINGERPRINT
REVALIDATE_IF
UNRESOLVED_DECISIONS
~~~

Normal/major implementation starts when UNRESOLVED_DECISIONS is NONE.

Tiny isolated PATCH_FIX work may keep this contract compact in the PR/task description.

If implementation exposes a genuinely new product/data/architecture decision outside the accepted contract, stop that block and return to planning.

## 5. New APP rule

A substantial new APP requires a Product Blueprint before broad build.

Discovery should establish:
- problem and users;
- main workflows;
- canonical entities/source systems;
- outputs;
- mobile/desktop needs;
- security/privacy boundary;
- integrations;
- migration direction;
- MVP boundary;
- success criteria.

Do not force the user to choose low-level IDs, table layouts or file splits when maintainers can derive them from business requirements.

## 6. Google Sheets Golden Architecture

When Google Sheets is backend, treat it as a database, not a manual working table.

~~~text
CANONICAL TABLES
STABLE IDS
ID-ONLY RELATIONS
BATCH + BOUNDED I/O
KNOWN ID → NEVER UNBOUNDED FULL SCAN
MINIMAL MUTATION HOT PATH
IDEMPOTENT MUTATIONS
MINIMAL LOCK SCOPE
DIAGNOSTICS FROM DAY ONE
CANONICAL / INDEX / CACHE / DERIVED SEPARATION
COMPLETE PAGINATION / SEARCH
~~~

Normal mutation hot path performs only required authorization/validation, idempotency guard, canonical durable write, minimal required durable relation/index/change-marker work, and compact ACK.

When correctness allows, dashboard rebuilds, broad analytics, reindex and maintenance stay outside synchronous save.

Scale-dependent indexes/cache/DirtyIndex/progressive hydration/offline patterns are implemented when evidence justifies the complexity.

Correctness, completeness, freshness, referential integrity and rollback take priority over benchmark speed.

## 7. No manual production schema mutation

Direct structural editing of a production Google Sheet is prohibited as a normal development path.

This includes:
- creating/deleting/renaming schema sheets;
- rewriting headers;
- adding/removing/reordering schema columns;
- manually changing schema-owned IDs/relations;
- editing migration/version markers as a shortcut.

Production schema/data-contract changes require:
1. repository-owned versioned migration/update logic;
2. MIGRATION_PLAN;
3. backup;
4. rollback;
5. TEST rehearsal;
6. user acceptance when runtime verification is required;
7. promotion of exact tested source;
8. preflight;
9. duplicate-run protection;
10. postflight verification/receipt.

A general request such as fix PROD does not authorize direct schema editing.

Emergency path is restore a known-good backup or build/rehearse/promote a guarded emergency migration.

## 8. Migration gate

Migration plan plus rollback are required when changing persisted contracts such as:
- sheet/table existence or names;
- columns or semantics;
- stable ID meaning;
- entity relations;
- stored statuses/enums;
- install/config behavior that changes stored interpretation;
- cross-module canonical ownership.

Migration should be additive/idempotent where practical.
Code deployment and data/schema migration are separate proof points.
Do not hide migration inside unrelated UI work.

## 9. Delivery profiles and invariant release gates

Release invariants apply to every profile: reviewed bounded source, required validation, exact candidate identity, appropriate TEST evidence, separate user acceptance when required, backup/migration/rollback safeguards, and explicit exact-source PROD approval. A branch name never proves acceptance.

### STABLE_MAIN — VBOS default

Feature branch -> checks/PR -> dedicated TEST -> runtime acceptance -> accepted candidate -> STAGING when material -> stable main -> explicit PROD release. Unfinished runtime must not enter main merely to obtain TEST access. Documentation and reviewed release infrastructure follow their own applicable checks.

### INTEGRATION_MAIN_TEST — named HMT/ZHEK existing delivery profile

This profile is explicitly registered only for VahramSargsyan/hmt-test-app and documents its existing delivery path; it is not a blanket exception for other repositories.

Branch -> PR -> required CI/review -> integration main -> validated main deploys TEST only -> runtime acceptance of exact SHA -> separately approved release manifest -> guarded PROD promotion of that exact SHA.

In this profile main is NOT accepted-production authority. A merge is CANDIDATE_INTEGRATED, never runtime PASS. PRODUCTION_RELEASE.json and associated exact-SHA acceptance evidence identify a release; a manifest assertion alone does not prove runtime checks. Later untested main commits cannot replace the approved SHA. One unaccepted runtime candidate per shared TEST by default. Never overwrite an active acceptance session with a different candidate. TEST data never flows automatically to PROD.

### RESEARCH_LOCAL / LEGACY_DISCOVERY

Analytical repositories preserve dataset/code/parameter evidence and research-to-live boundaries. Health/legacy discovery preserves source recovery prerequisites. These profiles do not invent a deployment pipeline or authorize live actions.

Profile changes require an explicit governance/delivery task. Do not copy the VBOS branch model into HMT or vice versa. Environment identifiers and lane ownership come from the current local registry and release records, not old examples.

## 10. Exact-source delivery

A deploy is not accepted merely because push succeeded.

Where supported, verify:

~~~text
approved commit
→ deployed source
→ pull-back/read-back
→ exact source equality
→ exact deployment version
→ receipt
~~~

Mismatch fails closed.

Prefer bounded workflow transactions:
backup → deploy → source verify → deployment verify → receipt.

## 11. Risk-based testing

Every non-trivial functional change identifies:

~~~text
RISK_CLASS: L1 / L2 / L3
DIRECTLY_AFFECTED
TRANSITIVE_DEPENDENCIES
UNAFFECTED_MODULES
SCALE_CRITICAL_TRIGGER: yes/no
WHY
~~~

L1: docs/style/read-only presentation.
Evidence: static validation plus focused smoke/version check as relevant.

L2: bounded business feature.
Evidence: static/targeted checks, impact regression, golden scenarios, deployed TEST/runtime check where applicable, post-release observation.

L3: core/performance/schema/financial invariant.
Examples: IDs/relations, migration, mutation hot path, cache/index freshness, pagination/search, locks/concurrency, finance invariants.
Evidence: full affected regression, migration/rollback/data compatibility, diagnostics, scale retest when triggered, explicit TEST acceptance before PROD.

Do not run huge stress tests for every local patch. Do not skip them when scale-critical architecture changed.

## 12. Testing honesty

Use exact evidence labels such as:

- STATIC_ONLY
- LOCAL_STRUCTURE_CHECK
- LOCAL_TESTED
- CI_VALIDATED
- DATA_PIPELINE_TESTED
- BACKTEST_EXECUTED
- OUT_OF_SAMPLE_TESTED
- WALK_FORWARD_TESTED
- GAS_DEPLOYED_TESTED
- TEST_RUNTIME_VERIFIED
- STAGING_VERIFIED
- MOBILE_DEVICE_TESTED
- PAPER_LIVE_OBSERVED
- LIVE_RUNTIME_VERIFIED

Static review is never runtime proof.

## 13. Performance evidence

Do not optimize blindly.

Where available inspect:
- total/backend latency;
- slowest step;
- rows read/written;
- Sheets service calls;
- lock wait;
- cache/index hit/miss/fallback;
- full-scan presence;
- transport contribution.

If the bottleneck is unknown, diagnose before patching.

Reference datasets remain immutable. Destructive benchmark writes use TEST copies, not production.

## 14. REUSE_FIRST → VERIFY_BEFORE_ADOPT

For non-trivial generic capability where mature solutions are likely, perform bounded OSS discovery.

Five gates:
1. LICENSE / PROVENANCE
2. ARCHITECTURE FIT
3. SECURITY / DEPENDENCIES
4. MINIMAL ADOPTION SCOPE
5. PROJECT-OWNED TEST ACCEPTANCE

Rules:
- public source does not mean reusable source;
- UNKNOWN LICENSE = NO CODE COPY;
- MIT/BSD/Apache are generally easier but notices still apply;
- GPL/AGPL/custom/source-available/unclear sources default to concept/pattern/test reference until explicit compatibility decision;
- prefer adapters and the smallest useful component;
- upstream tests do not replace local acceptance.

Material reuse records source repository, commit/tag, path/package, license, adoption mode, adapter boundary, dependencies, tests, notices and residual risks.

Do not assemble a Frankenstein architecture from whole projects when only isolated capabilities are needed.

## 15. Secrets and privacy

Never commit:
- OAuth credentials;
- .clasprc.json or equivalent auth state;
- API/broker/Telegram tokens;
- private keys/certificates;
- private personal exports;
- secrets from Script Properties;
- sensitive health/account/customer data unless the repository is explicitly approved for such storage.

Repositories define stricter local boundaries for health, finance, residents/customers and other sensitive domains.

Use synthetic/anonymized fixtures where possible.

## 16. Codex user gate

DEFAULT_CODEX_STATE: DISABLED

Do not start, route, request or trigger Codex unless Vahram explicitly asks for Codex in the current task.

Prior approvals, device state, quota availability or historical automation do not count.

Approval is one-task only unless the user explicitly defines a broader duration. A block agreement may define included checks and focused repairs; it cannot enable additional executors or paid API without the explicit permission required by the local gate.

Without explicit Codex approval use:
ChatGPT analysis → ChatGPT/GitHub implementation → repository checks → TEST/runtime verification.

Local Codex policy may be stricter but cannot weaken this gate.

## 17. AI/tool request-budget and WIP

Heavy tool/deploy/CI cycles are shared scarce resources.

Rules:
- one coherent functional block per delivery cycle;
- do not create PR/deploy loops for every tiny detail;
- split when P0/schema/migration/unrelated scope/shared-hotspot/rollback requires it;
- avoid retry/poll storms;
- on throttling preserve state and continue LIGHT work instead of brute-force retries;
- parallel chats are for context isolation, not quota bypass.

New low-intervention pilots default to one heavy delivery stream. Existing explicitly assigned experiments are resolved through current local environment/profile evidence; do not silently cancel them or start additional streams from stale defaults. See BOUNDED_CHAT_WORK_CONTRACT_v1.1.0.md FLOW-01. Separate TEST lanes do not create separate quotas.

## 18. Targeted freshness / Context Capsule

A reliable handoff may replace full rediscovery for continuation of the same bounded task.

Verify only mutable surfaces needed for the next action:
- main/accepted-parent SHA;
- owner branch/head;
- release manifest;
- named shared hotspots;
- schema/migration state;
- acceptance state;
- governance fingerprint.

Broad rediscovery is required when the task becomes materially different, governance changed, canonical contracts changed, integration/PROD begins, the capsule is stale/ambiguous, or shared hotspots moved.

A handoff never waives P0, migration, exact-source, environment isolation or testing honesty.

## 19. Versioning and visibility

Runtime-critical version metadata must be internally consistent where operationally used.

Do not mass-edit unrelated files merely to normalize historical comments.

For Apps Script runtime, keep stable runtime file names unless migration explicitly requires otherwise.

Version/build/mode should remain diagnosable in the deployed APP according to project convention.

## 20. Packaging / FULL_PACKAGE

When the user asks for an installable ZIP/package:
- FULL_PACKAGE is default;
- include exact files-to-copy;
- install instructions;
- patch notes;
- migration/rollback docs when applicable;
- golden tests;
- manifest/validation report for serious packages;
- honest TEST_LEVEL.

Normal GitHub work does not require ZIP for every commit unless that project uses ZIP delivery.

## 21. Real-world observation

After deployment, distinguish observation from patching.

Useful horizons:
- Day 1–3: blocking bugs/open/save failures;
- Week 1: UX friction and real edge cases;
- Week 2–4: data quality/repeated behavior/value;
- Month 1+: decide whether deeper automation/redesign is justified.

Classify observations:
BUG / UX_FRICTION / MISSING_FEATURE / DATA_QUALITY / PERFORMANCE / BAD_ASSUMPTION / NICE_TO_HAVE.

Do not turn every observation into an immediate patch.

## 22. No premature product optimization

Default loop:
minimal correct feature → real use → evidence → targeted improvement.

Design safety, data integrity, security, migration/rollback and known scale-critical architecture early.

## 23. Local repository adapter

Every active APP repository keeps a small local PROJECT_GOVERNANCE.md declaring:

~~~text
GOVERNANCE_VERSION
CANONICAL_SOURCE
LOCAL_PROFILE
LOCAL_AUTHORITY_FILES
LOCAL_P0_ADDITIONS
LAST_SYNC
~~~

The adapter may add stricter local rules but must not silently weaken the universal baseline.

If the canonical private repo may be inaccessible, the local adapter keeps a minimum P0 fail-safe mirror.

## 24. Governance sync

Document adoption and enforcement verification are separate states. Never equate a version string with semantic or runtime proof. A governance release is adopted only when:
1. canonical version is committed;
2. manifest/changelog updated;
3. active repository registry updated;
4. every active repo is SYNCED, explicitly PENDING, or OUT_OF_SCOPE;
5. no repo silently claims an older version as current authority.

Do not rely on memory to know which repositories are updated.

## 25. Final task report

Every APP-development final includes:

~~~text
WORKFLOW_MODE
RISK_CLASS when applicable
WHAT_CHANGED
FILES_CHANGED
FILES_TO_COPY / DEPLOY
MIGRATION_REQUIRED
TEST_LEVEL
WHAT_TO_VERIFY
RESIDUAL_RISKS
NEXT_BOUNDARY
~~~

Audit/stress/diagnostic-only reports explicitly say no code was changed.

If work is partial, say PARTIAL.

## 26. Definition of Done

A bounded task is not DONE merely because code exists.

DONE means applicable items are satisfied:
- scope respected;
- P0 preserved;
- canonical data protected;
- migration/rollback handled;
- tests match risk;
- exact TEST_LEVEL stated;
- delivery/source authority clear;
- secrets/privacy respected;
- OSS provenance recorded when reused;
- residual risks recorded;
- next boundary clear;
- local governance version not silently stale.


## 27. GOV-AUTHORITY — One authority and stable rule identifiers

Read the local AGENTS entrypoint and execution gate, then the exact canonical version named by the local adapter/manifest, then project delivery/environment/security rules and the current Build Packet. Platform/system constraints and explicit user instructions retain their applicable priority. Within project documentation, the named canonical version governs universal rules; local profiles specialize delivery without weakening release invariants. Conflicts affecting the action must be resolved before that action, not by choosing the newest filename.

v1.1.0 supersedes v1.0.0 as the adopted universal standard after its canonical PR is merged; downstream adoption is recorded separately. v0.4.9 is historical technical reference, not competing authority. Preserve its performance/data guidance when applicable and non-conflicting. Historical P0.n labels are qualified by source file+section and must not be used as unqualified active identifiers.

Active references use stable identifiers in RULE_INDEX.md and AUTH/EXEC/FLOW identifiers in the bounded contract. The original legacy/data/PROD protections remain P0. Packaging/presentation defects are release-quality failures when applicable, not proof of data corruption; no agent may downgrade a rule ad hoc. Rule changes preserve provenance and an audit-to-change mapping.

## 28. Bounded execution and evidence

BOUNDED_CHAT_WORK_CONTRACT_v1.1.0.md is normative and extends existing Build Packets. It provides bounded permission, stop/resume, retry, state, acceptance, external-content and pilot measurement rules. A template is not authorization. Subscription names, model names or device types do not grant actions or spending.

CURRENT_STATE_TEMPLATE.md separates observed source, deployed runtime, accepted candidate and authorized next block. Unknown fields stay UNKNOWN. Update state with evidence as part of the same task, not a separate bureaucracy cycle. Business decisions remain with Vahram; ordinary implementation details within accepted architecture do not require repeated confirmation.
