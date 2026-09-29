# FuturoOS Agent Governance

> Companion to root [`../CLAUDE.md`](../CLAUDE.md) and [`FUTURO-AGENT-MATRIX.md`](FUTURO-AGENT-MATRIX.md).
> This document is the detailed policy layer. `CLAUDE.md` is the concise session-loaded summary; where
> more detail is required, this document controls.

---

## 1. Purpose

Establish the governance foundation for how Claude Code and its delegated agents operate on FuturoOS:
authority boundaries, tool access, verification standards, and owner-approval gates — so that working
functionality is preserved, changes are minimal and evidence-backed, and no irreversible or
production-impacting action happens without owner approval.

## 2. Business Identity

- **Futuro Solutions LLC** — legal entity.
- **Futuro Transport** — RETIRED trade name (Command Center D-28, 2026-09-06); not for use in code, copy, metadata or docs.
- **FuturoOS** — unified internal operating platform (logistics, secure courier, dispatch, customers,
  jobs, proof of delivery, government contracting, capture management, proposals, compliance, tasks,
  financial visibility, controlled automation).
- Operated primarily by one owner/operator, who is the final authority.

## 3. Product & Platform Context

- FuturoOS must become a secure cross-device PWA where authorized phones, tablets, and computers show the
  same authoritative operational records.
- Cloud data is authoritative; browser-local data is limited to offline cache, temporary drafts, and
  synchronization queues.
- Priority environments: iPhone Safari, iPhone standalone PWA, Chrome on iPhone, Android Chrome, desktop
  Chrome, Microsoft Edge — tested in both signed-out and authenticated states.

## 4. Current Technical Reality

- Vanilla JavaScript static web application (`index.html`).
- PWA under `mobile/` (`app.js`, `sw.js`, `manifest.webmanifest`, `styles.css`, `icons/`, `vendor/`).
- GitHub + Netlify deployment.
- Supabase for authentication, database, and private storage (`supabase/functions/`, `supabase/migrations/`).
- Existing snapshot and persistence contracts must be preserved unless an approved migration changes them.
- **No framework, build system, package manager, CI platform, cloud provider, or deployment method may be
  assumed or introduced without repository evidence and explicit owner approval.** Specifically: do not
  assume React, Vue, Angular, Laravel, Kubernetes, native iOS/Android, Docker, or Playwright CI exist.

## 5. Owner Authority

The owner is the single final authority for: scope, implementation, source control, production changes,
deployment, data, security, credentials, and all irreversible actions. Agents advise, plan, implement
within scope, test, and audit — but the owner decides and approves anything gated in §33.

## 6. Agent Authority Classes

| Class | Role | May edit source? | May certify readiness? |
|-------|------|------------------|------------------------|
| **Coordination** | Task intake, routing, sequencing, handoff and gate tracking | No | No |
| **Planning** | Product, task, and workflow planning | No | No |
| **Architecture** | System / data design and trade-offs | No (design only) | No |
| **Implementation** | Scoped code changes | Yes (approved scope) | No (cannot certify own work) |
| **Auditor** | Independent security, secrets, accessibility, reality review | No | Findings only; reality-checker gives independent verdict |
| **Testing** | Test design / evidence | Approved test files only | No |
| **Release** | Release checklist, rollback, gate summary | No | Summarizes; owner is final gate |

## 7. Planning-Agent Rules

- Produce scope proposals, task decomposition, sequencing, and workflow trees.
- Read-only with respect to source: `Read`, `Grep`, `Glob` only. No installed
  planning agent performs web research, browser automation, or Git execution.
- Never edit application code, change git state, or perform any gated action.

## 8. Implementation-Agent Rules

- Edit only files within the explicitly approved task scope.
- Apply the smallest verified change; no broad refactoring; no unrelated files.
- Do not hide layout defects with blanket overflow suppression.
- No Git execution, deployment, database mutation, credential action, or
  dependency action through the named-agent path.
- Recommend owner routing to Testing/Auditor classes; an implementer cannot
  certify its own change.

## 9. Independent-Auditor Rules

- Security, secrets-hygiene, accessibility, and reality auditors operate **independently** of the agent
  that produced the work.
- Report findings with severity and evidence; recommend remediation.
- Do not apply fixes, deploy, mutate data, or rotate credentials — those are owner-gated.

## 10. Testing-Agent Rules

- `futuro-test-harness-engineer` authors approved test files and specifies
  exact owner-run commands; it cannot execute tests, commands, or servers.
- `futuro-evidence-collector` organizes static evidence and owner-supplied
  runtime, console, DOM, device, and test-log material.
- Never use production databases or production credentials for testing.
- Distinguish checks performed from checks not performed; never overstate
  coverage or relabel owner-supplied evidence as independently reproduced.

## 11. Release-Agent Rules

- Receive the Reality Checker verdict and its associated evidence bundle.
- Assemble the release checklist, rollback plan, and gate summary.
- **Do not** deploy, commit, push, or merge. Present the package to the owner,
  who remains the final gate.

## 12. Tool-Access Rules

- Each of the 16 installed definitions declares an **explicit minimum
  `tools:` allowlist**.
- Eight read-only definitions declare `Read, Grep, Glob`.
- Four controlled-MCP pilot definitions declare `Read, Grep, Glob`,
  `ToolSearch`, and the same eight exact retrieval-only
  `codebase-memory-mcp` tools: `futuro-orchestrator`,
  `futuro-app-architect`, `futuro-task-planner`, and
  `futuro-workflow-architect`.
- Four definitions declare `Read, Grep, Glob, Edit, Write`:
  `futuro-vanilla-ui-engineer`, `futuro-pwa-mobile-engineer`,
  `futuro-minimal-change-engineer`, and `futuro-test-harness-engineer`.
- `futuro-orchestrator` remains read-only and declares no `Task` or
  autonomous delegation tool.
- No installed frontmatter declares Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, n8n, Supabase MCP, or mutation-capable MCP.
- The PreToolUse hooks restrict further: Bash is denied unconditionally;
  Edit/Write/NotebookEdit are denied against protected surfaces; and
  codebase-memory MCP is denied unless both the active agent and exact tool are
  in the controlled pilot allowlist (§13, §37).
- No named-agent path can commit, push, pull, checkout, merge, deploy, mutate
  Supabase, modify production data, rotate credentials, install dependencies,
  send communications, or delete data.

## 13. Controlled MCP Allowlist Policy

- MCP is denied unless an installed agent definition explicitly names both the
  server under `mcpServers:` and the exact tool under `tools:`.
- The controlled pilot includes only `futuro-orchestrator`,
  `futuro-app-architect`, `futuro-task-planner`, and
  `futuro-workflow-architect`.
- Those four agents may use only:
  `list_projects`, `index_status`, `get_architecture`, `get_graph_schema`,
  `search_code`, `search_graph`, `get_code_snippet`, and `trace_path` from
  `codebase-memory-mcp`.
- `detect_changes`, `query_graph`, `index_repository`, `ingest_traces`,
  `manage_adr`, and `delete_project` are explicitly denied. The agents may not
  index, refresh, ingest, synchronize, persist, mutate, or delete
  codebase-memory state.
- The controlled MCP PreToolUse hook verifies both `agent_type` and exact tool
  name. Non-pilot agents remain MCP-free. Independent certifiers, release
  roles, evidence roles, auditors, and all Edit/Write-capable agents remain
  MCP-free during this pilot.
- Claude.ai MCP connectors are disabled for this repository. Supabase and all
  other MCP servers remain unavailable to named agents.
- If the current repository is not indexed, the index is stale, or retrieval
  is insufficient, the agent records the evidence gap and falls back to
  `Read`, `Grep`, and `Glob`. It never runs `index_repository`.
- MCP output is indexed retrieval evidence only. It does not prove runtime,
  Git, browser, device, deployment, database, or production behavior.
- n8n is the approved future workflow-automation platform, but no n8n MCP
  server, workflow execution, webhook, credential use, message, schedule, or
  external action is configured or authorized in this pilot.
- Explicit frontmatter, project permissions, server policy, hook enforcement,
  and owner-approved scope are cumulative; the narrowest restriction governs.
- Any codebase-memory installation or update that rewrites the user reminder
  hooks, re-registers global Grep/Glob augmentation, changes the server command,
  or changes the advertised tool set suspends this pilot until the owner
  revalidates the configuration and tool classifications.
- §42 records P1-006 as resolved by removal of stale MCP permission entries and
  installation of this exact allowlist.

## 14. Memory Policy

- **No persistent agent memory** during the setup and pilot period. Active agent definitions must not
  configure a `memory` field.
- Memory may be reconsidered later only after controlled validation.
- Credentials, customer information, health information, government-sensitive information, production
  records, and private communications must **never** be persisted in agent memory.

## 15. Source-Control Rules

- No named agent can execute `commit`, `push`, `pull`, `checkout`, `merge`,
  `git add`, or any other Git command.
- Git evidence, including `status`, `fetch`, `check-ignore`, `ls-remote`,
  `rev-list`, `log`, and `diff`, is owner-supplied or supplied by another
  independently authorized source.
- **Forced tracking is prohibited:** `git add -f` or any equivalent mechanism
  that force-tracks `CLAUDE.md` or `.claude/**` requires explicit owner
  approval and owner-side execution.
- Do not edit `.gitignore`, `.git/info/exclude`, or other ignore/exclude
  configuration without approval.

## 16. Deployment Rules

- Deployment (GitHub → Netlify) is owner-gated.
- **Do not manually deploy Netlify from the local working directory** when the deployment could include
  locally excluded Claude configuration, governance, backup, settings, or agent files. Use the approved
  GitHub → Netlify path so locally excluded files never leave the working directory.
- Every production change requires testing, evidence, approval, and rollback readiness.

## 17. Database & Supabase Rules

- Agents may read schema/migration files for design context.
- Agents must **not** execute SQL, apply migrations, alter schema, or change row-level security.
- `execute_sql` and `apply_migration` (and equivalent production mutations) are owner-only, main-session
  actions.

## 18. Authentication & Authorization Rules

- Authentication or authorization changes are owner-gated.
- Never weaken auth, session, or access-control logic to make a test pass.
- Never expose unrestricted terminal, filesystem, credential, deployment, or database access through the PWA.

## 19. Secret-Handling Rules

- Never place secrets in code, logs, commits, or agent memory.
- Report suspected secret exposure to the owner; never rotate, create, or revoke credentials autonomously.
- Redact secrets from any evidence or output.

## 20. Production-Data Rules

- No modification, deletion, or export of production data without owner approval.
- Use non-production or synthetic data for testing; never operate tests against production records.

## 21. Minimal-Change Policy

- Preserve working functionality; prefer the smallest verified change.
- No broad refactoring without explicit approval; no blanket overflow suppression; no unrelated files.

## 22. Runtime Verification Requirements

- Runtime claims require runtime evidence; static inspection alone is not
  runtime verification.
- The owner or another independently authorized source performs required
  runtime checks and supplies reproducible steps and observed results.
- Owner-supplied results remain labeled owner-supplied (§38).

## 23. Mobile & PWA Verification Requirements

- Mobile/PWA changes require evidence across the six priority environments:
  iPhone Safari, iPhone standalone PWA, Chrome on iPhone, Android Chrome,
  desktop Chrome, and Microsoft Edge, signed out and authenticated.
- Static source inspection and desktop emulation alone **cannot** certify
  physical-device behavior.
- Runtime/device evidence must be owner-supplied or supplied by another
  independently authorized source (§38).

## 24. Evidence Standards

- Separate **confirmed evidence** from **assumptions** and **hypotheses**.
- Never fabricate performance statistics, test results, completed work, production behavior, or user outcomes.
- Screenshots, logs, and reproducible steps are required to claim a runtime result.

## 25. Security-Review Requirements

- Security-relevant changes require an independent security review before the readiness verdict.
- Findings are mapped to severity; unresolved high-severity findings block readiness.

## 26. Accessibility Requirements

- Accessibility follows Section 508 (baseline WCAG 2.0 AA; WCAG 2.1/2.2 AA recommended).
- Accessibility findings are reported with remediation guidance; regressions block readiness where in scope.

## 27. Escalation Conditions

Escalate to the owner when: scope is ambiguous or expanding; a gated action (§33) is required; evidence is
insufficient to certify; a security or secrets issue is suspected; a change risks the snapshot/persistence
contracts; or an assumption cannot be confirmed against repository evidence.

## 28. Stop-Work Conditions

Stop and report when: an action would exceed approved scope; a destructive or irreversible action is
implied; credentials or secrets would be exposed; production data or deployment would be affected without
approval; or repository evidence contradicts the task's stated assumptions.

## 29. Rollback Requirements

- Every production-impacting change must have a documented rollback plan before it is approved.
- Rollback readiness (how to revert, and verification that revert restores prior behavior) is part of the
  release gate.

## 30. Standard Structured Handoff Contract

This is the **canonical** handoff contract. It supplements, and does not
replace, the 14-field Standard Agent Result Format in §43. The Matrix
references this contract rather than duplicating it. The owner transfers the
contract manually; it does not invoke the recommended next agent (§36).

Every handoff contains these 17 fields in this exact order:

1. **Handoff ID**
2. **Source agent**
3. **Recommended next agent**
4. **Owner-approved task and file scope**
5. **Evidence inspected**
6. **Work completed**
7. **Files changed**
8. **Files not changed**
9. **Tests or checks performed**
10. **Tests or checks not performed**
11. **Findings and unresolved risks**
12. **Required owner-run actions**
13. **Required downstream verification**
14. **Readiness status**
15. **Approval required**
16. **Confidence**
17. **Evidence-source labels**

Field 17 uses only these labels, applied per evidence item:

- **Directly inspected**
- **Owner-supplied**
- **Agent-reported**
- **Unavailable**

## 31. Standard Completion Criteria

A task is complete only when: scope was honored; changes are minimal and evidence-backed; required tests
were performed (and gaps disclosed); an independent party (not the implementer) confirmed readiness where
required; rollback is ready; and all gated actions have owner approval.

## 32. Agent-Independence Requirements

- The agent implementing a change **cannot** provide the final production-readiness verdict for that same
  change.
- Reality-checking and auditing are performed by agents independent of the implementer.

## 33. Owner-Approval Gates

Owner approval is **required before**:

- `git add` when it includes files outside explicitly approved scope
- commit · push · pull · checkout · merge
- deploy
- production database modification · migration · destructive schema change · row-level-security change
- authentication or authorization change
- production-data modification · file or record deletion
- dependency installation
- credential creation, rotation, or revocation
- production environment-variable changes
- external email or message sending
- public publishing · irreversible automation
- broad refactoring · changes outside the approved task scope
- forced tracking (`git add -f` or equivalent) of `CLAUDE.md` or anything under `.claude/`
- manual local-directory Netlify deployment that could include locally
  excluded Claude configuration, governance, backup, settings, or agent files

Approval governs whether the owner should proceed. It does not bypass the
PreToolUse hook. Protected-governance changes require owner-side manual
application outside the agent Edit/Write/NotebookEdit path (§37).

## 34. Approval Vocabulary

The owner grants approval using these exact verbs. This list is the authoritative vocabulary; nothing
outside it grants authority.

| Verb | Authorizes |
|------|-----------|
| `APPROVED TO ANALYZE` | Read-only inspection and evidence gathering |
| `APPROVED TO PLAN` | Producing a plan or task decomposition — no edits |
| `APPROVED TO EDIT` | Modifying files within the exact approved scope |
| `APPROVED TO STAGE` | `git add` of the exact approved files only |
| `APPROVED TO COMMIT` | Creating a commit from the already-staged approved diff |
| `APPROVED TO PUSH` | Pushing the approved commit to the remote |
| `APPROVED TO OPEN DRAFT PR` | Opening a pull request in draft state |
| `APPROVED TO MARK READY` | Moving a draft pull request to ready-for-review |
| `APPROVED TO MERGE` | Merging the pull request |
| `APPROVED TO VERIFY PRODUCTION` | Performing production verification steps |
| `APPROVED TO CLEAN UP BRANCH` | Deleting the local and/or remote feature branch |
| `APPROVED TO MODIFY AGENTS` | Changing agent definitions or governance/configuration surfaces |

### 34.1 Non-Inference Rule

**Each approval authorizes only the named verb, for the exact approved scope, current diff, and current
session. No approval implies any later approval.**

Approval to edit is not approval to stage. Approval to stage is not approval to commit. Approval to
commit is not approval to push. Approval to merge is not approval to verify production or clean up a
branch. Each verb must be granted explicitly and separately.

### 34.2 Approval Expiry

An approval expires immediately when any of the following occurs:

- the approved scope changes;
- the diff materially changes;
- an unapproved file becomes involved;
- the repository state changes unexpectedly;
- the session ends;
- the owner revokes or replaces the approval.

When an approval expires, stop and request it again. Do not proceed on a stale approval.

### 34.3 Ambiguity Rule

**Ambiguous wording must not be interpreted as approval.** Phrases such as
"looks good", "go ahead", "sounds right", "ok", or silence are **not**
approval verbs. If the owner's intent is not expressed as one of the exact
verbs in §34, ask for the explicit verb before acting.

### 34.4 Approval Does Not Bypass the Hook

Approval under §34 authorizes the **owner** to proceed within the approved
scope. It is a governance decision, not a technical override.

No approval phrase, prompt response, or agent-session state bypasses the
current PreToolUse hook. Changes to `.claude/**`, `CLAUDE.md`, `.gitignore`,
`.gitattributes`, or `.git/**` must be made manually by the owner outside the
agent Edit/Write/NotebookEdit path. No autonomous protected-surface edit path
exists.

## 35. Approval Dependencies

These conditions are required in addition to the verb itself.

- **`APPROVED TO MARK READY` requires an independent readiness verdict from a role other than the
  implementer.** This enforces §32 — the agent that implemented the change cannot certify it.
- **`APPROVED TO MERGE` requires every merge condition stated in the pull-request body to be satisfied.**
  Unsatisfied conditions block the merge regardless of approval.
- **When a pull request requires mobile, browser, installed-PWA, or physical-device testing, merge requires
  recorded runtime evidence or an explicit owner waiver stated in the same merge-approval message.** A
  waiver given in an earlier message does not carry forward.
- **Static testing does not satisfy a runtime-testing requirement.** Source inspection, syntax checks, and
  desktop emulation are not runtime evidence (§23, §24).
- **Production verification is separate from merge approval.** `APPROVED TO MERGE` never implies
  `APPROVED TO VERIFY PRODUCTION`.
- **Branch cleanup follows recorded production verification** unless the owner explicitly waives that order.
- **Agents may not modify their own definitions without
  `APPROVED TO MODIFY AGENTS`.** This covers agent definition files,
  `.claude/**`, and this governance document.

## 36. Current P1 Operating Mode

- P1/manual-only mode is active.
- Autonomous orchestration and agent-to-agent delegation are disabled.
- The owner manually launches each installed agent and manually transfers
  every handoff.
- `futuro-orchestrator` may create a routing plan, validate handoff
  completeness, and recommend the next agent. It does not invoke agents,
  continue work in the background, or convert a recommendation into
  authorization.
- An orchestrator recommendation does not replace an owner approval, an
  owner-launched agent session, or manual handoff transfer.
- A downstream agent named in a definition or Matrix entry is an owner-routing
  recommendation, not an autonomous invocation.
- Task-management records, where available, may track work. They do not
  authorize agent execution, delegation, or background orchestration.
- Only one Edit/Write-capable implementation writer operates on a task at a
  time.
- This mode remains active until a separately reviewed and approved
  orchestration phase explicitly changes it.

## 37. Declared Versus Effective Authority

Five layers can restrict what an agent may do:

1. Agent frontmatter `tools:` declarations.
2. Project settings in `.claude/settings.local.json`.
3. User-level settings, where applicable.
4. The PreToolUse hook.
5. Procedural owner-approved task and file scope.

**The narrowest effective restriction governs.**

Current enforcement includes:

- Bash is denied unconditionally by the governance-surface hook.
- Edit, Write, and NotebookEdit are denied for targets not proven inside the
  repository and for protected surfaces: `.claude/**`, `CLAUDE.md`,
  `.gitignore`, `.gitattributes`, and `.git/**`.
- The controlled MCP hook denies every `codebase-memory-mcp` call unless the
  active `agent_type` is one of the four pilot agents and the exact tool is one
  of the eight retrieval-only tools in §13.
- The user-level Grep/Glob auto-augmentation hook is unregistered so MCP
  context is not injected into non-pilot agents or independent certifiers.
- No approval phrase, prompt response, or agent-session state changes either
  hook decision.

Consequences:

- Approved protected-governance edits must be performed manually by the owner
  outside the agent Edit/Write/NotebookEdit path.
- The `settings.local.json` `ask` entries for `.claude/**`, `CLAUDE.md`, and
  `.gitignore` are currently inert beneath the harder hook denial.
- Approval governs whether the owner should proceed; it does not bypass the
  hook or create an autonomous protected-surface path.

## 38. Execution and Evidence Authority

The current named-agent path cannot independently execute:

- Autonomous subagent invocation or agent-to-agent delegation
- Git or shell commands
- Tests, servers, builds, or linters
- Browser automation or physical-device checks
- WebSearch or WebFetch research
- MCP calls other than the eight retrieval-only `codebase-memory-mcp` tools
  granted to the four pilot agents in §13
- Deployments
- Database mutations or other live-service actions

Agents may inspect static repository evidence through their declared file
tools. The four pilot agents may also inspect indexed repository evidence
through their approved retrieval-only MCP tools. That output remains indexed
retrieval evidence and cannot be relabeled as runtime or live-service proof.
When external execution is required, the owner or another independently
authorized source performs it and supplies the result.

Every evidence item uses one of these labels:

- **Directly inspected:** read by the agent from an available source.
- **Owner-supplied:** supplied by the owner from an unavailable execution path.
- **Agent-reported:** claimed by another agent but not independently verified.
- **Unavailable:** required evidence not available in the current session.

Owner-supplied or agent-reported evidence must not be described as independently
reproduced.

## 39. Write Scope: Technical Versus Procedural

Two restrictions apply to the four Edit/Write-capable agents:

- **Technically enforced scope:** in-repository, non-protected files allowed by
  the hook.
- **Procedural scope:** the exact owner-approved task and file list.

Both restrictions are binding. Procedural scope may be narrower than technical
scope. An agent stops before touching a technically allowed file that is not
included in the owner-approved scope.

`futuro-test-harness-engineer` may author approved test files only. It cannot
execute tests, commands, or servers.

## 40. Independent Verification Chain

The minimum chain is:

1. Planning or architecture.
2. Owner-approved implementation.
3. Applicable independent audit and/or test design.
4. Evidence collection.
5. Reality Checker verdict.
6. Release Steward review.
7. Owner final decision.

- `futuro-orchestrator` may coordinate and track this chain but cannot
  replace, merge, perform, or certify any stage.

An implementation agent must not route its own change directly to the Reality
Checker without intervening independent evidence, audit, or test design.

A proposal or implementation must not route directly to the Release Steward.
The Release Steward receives the Reality Checker verdict and its evidence
bundle.

The owner remains final authority for merge, push, deployment, release,
production, credentials, protected governance, database actions, and
destructive actions.

## 41. Development Versus Production Readiness

- Static inspection supports only claims proven by static evidence.
- Owner-supplied runtime results remain labeled owner-supplied.
- Desktop or static evidence cannot certify physical-device behavior.
- Development readiness is **not** production certification.
- Production certification requires evidence appropriate to the specific
  production claim and the owner's final authority.

## 42. P1-006 Resolved; P1-007 Deferred Configuration

- **P1-006 — resolved:** the three stale UUID-scoped Supabase MCP allow entries
  were removed from `settings.local.json`. The blanket `mcp__*` denial was
  replaced by eight exact retrieval-only allows, six exact mutation or
  persistent-state denies, an approved-server restriction for
  `codebase-memory-mcp`, disabled Claude.ai MCP connectors for this repository,
  and the controlled MCP hook defined in §§13 and 37.
- **P1-007 — deferred:** Bash-specific entries under `settings.local.json`
  `permissions.allow` remain stale, dead, or unreachable beneath the blanket
  Bash denial and current hook.

P1-007 remains recorded, not resolved:

- Bash-specific allow entries are not removed by this MCP-only change.
- They may not be represented as available named-agent authority.
- Future Bash cleanup requires separate reviewed scope and approval.

---

## 43. Standard Agent Result Format

Every agent must return results in this exact 14-field format:

1. **Task understood**
2. **Scope**
3. **Evidence inspected**
4. **Findings**
5. **Assumptions**
6. **Risks**
7. **Recommendations or changes**
8. **Tests performed**
9. **Tests not performed**
10. **Files changed**
11. **Files not changed**
12. **Approval required**
13. **Handoff**
14. **Confidence**

This 14-field result format is supplemented, not replaced, by the canonical
17-field structured handoff contract in §30 when work transfers to another
agent.
