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
- **Futuro Transport** — DBA and logistics / secure-courier operating branch.
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
| **Planning** | Product, task, and workflow planning | No | No |
| **Architecture** | System / data design and trade-offs | No (design only) | No |
| **Implementation** | Scoped code changes | Yes (approved scope) | No (cannot certify own work) |
| **Auditor** | Independent security, secrets, accessibility, reality review | No | Findings only; reality-checker gives independent verdict |
| **Testing** | Test authoring, execution, evidence capture | Tests only / no source | No |
| **Release** | Release checklist, rollback, gate summary | No | Summarizes; owner is final gate |

## 7. Planning-Agent Rules

- Produce scope proposals, task decomposition, sequencing, and workflow trees.
- Read-only with respect to source; may use research tools where assigned.
- Never edit application code, change git state, or perform any gated action.

## 8. Implementation-Agent Rules

- Edit only files within the explicitly approved task scope.
- Apply the smallest verified change; no broad refactoring; no unrelated files.
- Do not hide layout defects with blanket overflow suppression.
- No autonomous git state changes, deployment, database mutation, or credential/dependency actions.
- Hand finished work to Testing/Auditor classes; cannot certify own change.

## 9. Independent-Auditor Rules

- Security, secrets-hygiene, accessibility, and reality auditors operate **independently** of the agent
  that produced the work.
- Report findings with severity and evidence; recommend remediation.
- Do not apply fixes, deploy, mutate data, or rotate credentials — those are owner-gated.

## 10. Testing-Agent Rules

- Author and run tests; capture runtime and device evidence.
- Never use production databases or production credentials for testing.
- Distinguish tests performed from tests not performed; never overstate coverage.

## 11. Release-Agent Rules

- Assemble the release checklist, rollback plan, and gate summary.
- **Do not** perform the deploy, commit, push, or merge — present the summary to the owner, who is the
  final gate.

## 12. Tool-Access Rules

- Each active agent definition (created later) must declare an **explicit minimum `tools:` allowlist** —
  least privilege. No agent receives more tools than its class requires.
- Read-only classes (Planning, Architecture, Auditor) receive read/search tools and reporting only — no
  Edit/Write.
- Implementation agents receive Edit/Write scoped to approved files, plus read/search.
- Testing/evidence agents receive read/search, scoped test editing where applicable, and browser-driving
  for runtime evidence.
- No agent receives tools that can commit, push, pull, checkout, merge, deploy, mutate Supabase, modify
  production data, rotate credentials, install dependencies, send communications, or delete data.

## 13. MCP Default-Deny Policy

- **MCP is default-deny for every project subagent.** During the initial pilot, no project subagent
  receives any MCP tools.
- Supabase (and all other MCP servers) remain with the **owner-controlled main session** unless separately
  approved later.
- When active agent definitions are created later, this must be **enforced through explicit minimum
  `tools:` allowlists** that simply omit MCP tools. **Do not rely on undocumented wildcard MCP syntax** to
  grant or deny MCP access.

## 14. Memory Policy

- **No persistent agent memory** during the setup and pilot period. Active agent definitions must not
  configure a `memory` field.
- Memory may be reconsidered later only after controlled validation.
- Credentials, customer information, health information, government-sensitive information, production
  records, and private communications must **never** be persisted in agent memory.

## 15. Source-Control Rules

- No autonomous `commit`, `push`, `pull`, `checkout`, or `merge`.
- `git add` limited to explicitly approved files; adding out-of-scope files requires owner approval.
- **Forced tracking is prohibited:** `git add -f` — or any other mechanism that force-tracks
  `CLAUDE.md` or anything under `.claude/` — is not allowed unless the owner provides explicit approval.
- Do not edit `.gitignore`, `.git/info/exclude`, or other ignore/exclude configuration without approval.
- Read-only git inspection (`status`, `fetch`, `check-ignore`, `ls-remote`, `rev-list`) is permitted.

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

- Verify behavior at runtime, not only through static inspection.
- Provide reproducible steps and observed results as evidence.

## 23. Mobile & PWA Verification Requirements

- Mobile/PWA changes must be verified across the six priority environments (iPhone Safari, iPhone
  standalone PWA, Chrome on iPhone, Android Chrome, desktop Chrome, Microsoft Edge), in both signed-out and
  authenticated states.
- Static source inspection and desktop emulation alone **cannot** certify physical-device behavior.

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

## 30. Standard Handoff Format

Each handoff between agents states: what was done, evidence produced, files touched (and not touched),
open risks/assumptions, what the next agent must verify, and what still requires owner approval.

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
- manual local-directory Netlify deployment that could include locally excluded Claude configuration,
  governance, backup, settings, or agent files

---

## Standard Agent Result Format

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
