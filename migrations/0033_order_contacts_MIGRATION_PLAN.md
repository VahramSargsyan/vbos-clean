# ORDER_CONTACT_JOURNAL_BATCH1 — 0033 MIGRATION_PLAN (CANDIDATE)

CAPABILITY_ID: VBOS_CLEAN_ORDER_CONTACT_JOURNAL_BATCH1
MODE: IMPLEMENT_FEATURE / source-only preparation
RISK: L3 (new persisted table) / L2 (owner-only UI)
OWNER/TEST: Vahram / isolated Clean Render TEST
BASE: a327e09682d373ddb55a9101bb905a5b5991b195 (unaccepted PR #1275 source candidate)
SOURCE: feature/vbos-clean-order-contacts-20261112 (stacked candidate)
NO TEST/PROD SQL EXECUTED BY THIS BUILD PACKET.

## Exact source and scope

The new canonical table `public.mvp_order_interactions` stores *new* Order-scoped
communications, referenced by the immutable existing `public.mvp_orders.id` UUID.
No renaming/deleting/migrating of existing interactions, Order columns, owner,
statuses, Google records, Lead relations, or WorkLogs.
Data columns: request key/hash, exact order_id FK RESTRICT, interaction kind, summary,
optional next action/date, notes, active status, created_at.
Date time follows original Object-contact `YYYY-MM-DDTHH:MM` wall clock,
`timestamp without time zone`; it is not a scheduled reminder.
New contacts are allowed on existing/closed/imported Orders without editing
the canonical Order record.

## Required exact rehearsal

1. Freeze source candidate SHA, previous client-portfolio PR, Test owner/lane,
   and current Render+Neon receipts; verify no concurrent shared TEST schema write.
2. Execute file `0033_order_contacts_CANDIDATE.sql` **twice** on disposable
   PostgreSQL, verify same constraints/index with no duplicate schema.
3. Run real E2E: signed owner auth on both GET/POST, valid Order FK,
   non-existing Order 404, wrong entityType 400, request replay idempotent,
   same-key conflicting payload 409, malformed datetime 400, cursor
   from Order A on Order B 400, pagination and isolation, JSON export,
   checked absence of changes to existing Object interactions and WorkLogs.
4. Only after feature stack accepted as a single source and a separate
   authorized TEST migration/deployment checkpoint: independently recoverable
   backup of isolated Neon TEST with verified source identity and counts;
   apply exact 0033 via official Neon mechanism; read back schema/rows.
5. Deploy **one exact validated commit** to existing authorized Render TEST,
   verify hosted build SHA/runtime and owner functional acceptance in Android PWA.
   Source-only checks do not imply Render or user acceptance.

## Rollback and recovery

Before installation: discard source-only feature branch.
After additive TEST migration: revert runtime to exact prior compatible SHA,
but do not drop `mvp_order_interactions` and do not lose owner-entered notes.
A destructive rollback is separate owner-approved recovery with backup/reads.
Do not disable tests, change ids, modify PROD, or auto-promote main.

## Stop conditions and exclusions

No installation if disposable replay, safe backup, source identity, FK,
owner auth, export completeness, or prior candidate coordination fails.
Not included: Lead→Order policy, old contact backfill, auto reminders,
Object/Client/Lead journal merging, PROD, Finance.
