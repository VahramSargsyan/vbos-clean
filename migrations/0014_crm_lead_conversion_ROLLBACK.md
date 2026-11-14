# CRM-01 — additive TEST migration / rollback contract

**Candidate:** `0014_crm_lead_conversion_TEST_ONLY.sql`. **Risk:** L3 persisted Lead↔Client↔Object relations.
**Source:** accepted Clean V14 branch commit `efe742b8cb7528de12557784b2d358b6bdc030e4`.
**Target, only after separate release authorization:** Neon project `proud-hat-90291191`, branch `br-crimson-hat-b9kwg7n6`, database `vbos_mvp_clean`, then exact source Render TEST `srv-dbkvfh2jnfac73a31nv0`. NEVER Google/legacy PROD.

## Before any canonical TEST SQL
1. Revalidate exact approved PR commit, CI, source branch lease and current Render version. Independently query all three target parent tables, legacy provenance, 0/expected existing CRM links and source hashes. Existing baseline has 0 Leads, 17 Clients (16 nonempty unique phones, 1 empty), 18 Objects, 4 Google-owned Orders, but all numbers must be refreshed.
2. Validate existing `mvp_crm_lead_client_links` and `mvp_crm_conversion_requests` are absent or match the exact accepted schema. Resolve any namespace conflict, no blind overwrite.
3. **Native database recovery:** fresh independent/restorable copy of canonical TEST, schema + row-wise content readback and documented restoration plan. Last known Neon Free branch quota **10/10** with protected backups. Do not delete branches/snapshots or buy capacity without owner permission. The earlier pre-V13 backup alone is not a fresh CRM-01 backup. If recovery cannot be established, STOP.
4. Rehearse exact SQL twice on disposable PostgreSQL. Rehearse end-to-end owner auth: existing-client conversion, unique match confirm, ambiguous phones, wrong object, repeated lead, concurrent attempts, generated new client, duplicate request ID, stale revision, status bypass and failed transaction rollback.
5. Confirm release owner approved canonical migration and understands change: only conversions become linked; existing direct Clients/Objects/Orders stay grandfathered. No retroactive reparenting; client-create remains possible pending separate business policy.

## Apply / readback
- Run the exact source SQL on **TEST only** via the official Neon transactional mechanism, not manual interactive edits. There are two additive tables, one phone canonical function and two nonunique indexes. No existing table is rewritten. Execute in a transaction, stop on any checksum or table count deviation.
- Check both new tables and phone function/index definitions; assert no new relations or receipts on installation.
- Verify existing tables' row-level digests/counts and 4 Google-owned orders unchanged; crosscheck the independent backup. Perform code release only after schema is in place, using exact commit source lease, Render deployment receipt and health/startup checks.
- Authenticated Android/native conversion testing is a separate owner acceptance checkpoint.

## Safe rollback
- **Before any real conversion:** prefer rollback of runtime to V14 exact `efe742b8cb7528de12557784b2d358b6bdc030e4`, leaving dormant additive tables; optional isolated schema cleanup requires exact absence proof and separate approval.
- **After any conversion:** NEVER drop relation or idempotency table as an automatic rollback. Restore prior code only after ensuring it does not misrepresent `won` statuses. New converted Clients/Leads/Links are real data and require preservation-first recovery or a separately authorized reversible repair plan; a blind pre-migration snapshot restore would lose new records.
- Do not weaken legacy Google ownership or modify production, old IDs, client source mapping or financial balances.

**Rollback rehearsal:** NOT_RUN until exact migration is rehearsed in disposable CI. **Canonical SQL:** NOT_RUN in this candidate. **User acceptance / PROD:** NOT_RUN.
