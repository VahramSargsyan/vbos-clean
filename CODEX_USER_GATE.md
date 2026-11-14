# Codex user gate — highest-priority execution rule

Status: ACTIVE / HIGHEST_PRIORITY_FOR_CODEX_ROUTING
Effective: 2026-08-30

This file overrides `CODEX_EXECUTION_POLICY.md`, `.github/codex/AUTOMATION_CONTRACT.md`, prior chat assumptions, device-based routing, quota logic, and any earlier standing approval whenever Codex use is being considered.

## P0 — Codex is disabled by default

`DEFAULT_CODEX_STATE: DISABLED`

Do **not** start, trigger, route to, or request Codex for any task unless Vahram explicitly asks for Codex in the current task/request.

This prohibition includes:

- Codex implementation/coding;
- Codex audit or diagnostic work;
- Codex stress/review passes;
- Codex GitHub issue automation;
- paid API Codex;
- manual ChatGPT/Codex routing;
- Codex code review bots/checks initiated by ChatGPT;
- automatic Codex CI repair;
- creating `[CODEX TASK]` issues on the user's behalf.

## What counts as explicit approval

Approval must be a direct current instruction such as:

- `используй Codex`;
- `запусти Codex`;
- `сделай это через Codex`;
- another equally explicit instruction naming Codex for the current task.

The following do **not** count as approval:

- the user is on a phone;
- the user previously configured mobile automation;
- Codex would be faster or cheaper;
- the task is L2/L3/high-risk;
- Codex quota is available;
- a previous task had Codex approval;
- an old GitHub issue or automation contract allows Codex.

## Approval lifetime

Codex approval is **one-task only** unless the user explicitly states a broader duration.

After that task ends, the state automatically returns to:

`DEFAULT_CODEX_STATE: DISABLED`

Do not reuse approval for a new block, another repository or an unapproved expense. If the explicit approval defines a bounded implementation block including checks and focused repairs, those named actions remain within that approval until the block ends. Without that scope, do not infer extra Codex runs. Revocation ends permission immediately.

## Default maintainer path

Without explicit Codex approval, use:

`ChatGPT analysis → ChatGPT/GitHub implementation → repository CI/static checks → TEST runtime verification when required → user acceptance → explicit PROD gate`

If current tools can perform the task, proceed directly without asking whether Codex should be used.

If a task genuinely cannot be completed without Codex, explain the blocker and wait for explicit user authorization. Do not silently trigger Codex.

## Revocation / pending work

If the user says not to use Codex after a Codex task has already been started:

- stop/cancel it when the available tools allow;
- close the task issue/PR if it exists and is not wanted;
- do not reuse its output unless the user explicitly asks;
- continue with ChatGPT/GitHub tools where possible.

## Conflict rule

When any repository document conflicts with this gate, this file wins for Codex routing.

Codex-specific cost profiles, device routing, reviewer-first policy, and automation envelopes apply **only after** this explicit user gate has been opened for the current task.

## Invoked assistant versus additional execution

This gate controls starting additional Codex tasks, API automation, reviewers or delegated runs. It does not require the user to re-authorize the assistant they are currently addressing to perform the explicitly requested task through its existing tools. It grants no permission to create a new executor or spend paid API credits. User/model/product naming alone must not cause a routing loop.
