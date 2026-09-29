# FuturoOS — Claude Code Project Instructions

> **Authoritative project instruction file.** Read this every session. It is intentionally concise;
> detailed policy lives in [`.claude/FUTURO-AGENT-GOVERNANCE.md`](.claude/FUTURO-AGENT-GOVERNANCE.md)
> and the agent roster lives in [`.claude/FUTURO-AGENT-MATRIX.md`](.claude/FUTURO-AGENT-MATRIX.md).
> Where this file and the governance document agree, both bind. Where more detail is needed, the
> governance document controls.

---

## 1. Business Identity

- **Futuro Solutions LLC** — the legal entity.
- **Futuro Transport** — RETIRED trade name (Command Center D-28, 2026-09-06): archived, dormant, not for use in code, copy, metadata or docs. There are no divisions or division brands; "Futuro Federal" was never declared (D-05).
- **Futuro_OS** — the unified internal operating platform (formal name, Command Center D-29). "FuturoOS" and "FuturoFreight" are prior naming of the same system; no repository, database, deployment or path rename is authorised by D-29.
- The platform is currently operated primarily by **one owner/operator**.
- The **owner is the final authority** for scope, implementation, source control, production changes,
  deployment, data, security, credentials, and all irreversible actions.

## 2. FuturoOS Purpose

FuturoOS combines logistics, secure courier operations, dispatch, customers, jobs, proof of delivery,
government contracting, capture management, proposals, compliance, tasks, financial visibility, and
controlled automation into one internal operating platform.

## 3. Actual Technical Stack (evidence-based only)

- **Vanilla JavaScript static web application** — root `index.html`.
- **Progressive Web App (PWA)** under `mobile/` (`app.js`, `sw.js`, `manifest.webmanifest`, `styles.css`).
- **Deployment** through GitHub and Netlify.
- **Supabase** provides authentication, database services, and private storage.
- The application has existing **snapshot and persistence contracts** that must be preserved unless an
  approved migration changes them.
- **Do not assume** React, Vue, Angular, Laravel, Kubernetes, native iOS, native Android, Docker,
  Playwright CI, or any other framework/platform exists unless repository evidence proves it.
- **Do not introduce** a framework, build system, package manager, CI platform, cloud provider, or
  deployment method without explicit owner approval.

## 4. Product Direction

- FuturoOS must become a **secure cross-device PWA**.
- Authorized phones, tablets, and computers should display the **same authoritative operational records**.
- **Cloud data is authoritative.**
- **Browser-local data is limited to** offline cache, temporary drafts, and synchronization queues.
- **FEATURE FREEZE (owner, 2026-09-28 — Command Center hardening Control 6):** no new modules. Only security patches and brand/display-string corrections are allowed until the owner lifts the freeze. The redesign for autonomous use starts from the v4 domain objects (devices, sites, events, custodians, tiers, certificates), not the courier model; courier-only modules are removed at redesign.

## 5. Supported Environments

Test both **signed-out and authenticated** states across:

- iPhone Safari
- iPhone Home Screen standalone PWA
- Chrome on iPhone
- Android Chrome
- Desktop Chrome
- Microsoft Edge

**Static source inspection cannot certify runtime mobile behavior.** Physical-device behavior must not
be certified solely through desktop emulation.

## 6. Minimal-Change Rules

- Preserve working functionality.
- Prefer the **smallest verified change**.
- Do not perform broad refactoring without explicit approval.
- Do not hide layout defects with blanket overflow suppression.
- Do not create unrelated files, folders, or documentation.

## 7. Evidence & Honesty Requirements

- Distinguish **confirmed evidence** from **assumptions** and **hypotheses**.
- Do not claim a task passed unless evidence proves it.
- Do not fabricate performance statistics, test results, completed work, production behavior, or user
  outcomes.

## 8. Owner Approval Gates

Owner approval is **required before** any of the following. See the governance document for the full
enumerated list.

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

### 8.1 Approval Vocabulary (summary)

Approval is granted only with these exact verbs:

`APPROVED TO ANALYZE` · `APPROVED TO PLAN` · `APPROVED TO EDIT` · `APPROVED TO STAGE` ·
`APPROVED TO COMMIT` · `APPROVED TO PUSH` · `APPROVED TO OPEN DRAFT PR` · `APPROVED TO MARK READY` ·
`APPROVED TO MERGE` · `APPROVED TO VERIFY PRODUCTION` · `APPROVED TO CLEAN UP BRANCH` ·
`APPROVED TO MODIFY AGENTS`

**Each approval authorizes only the named verb, for the exact approved scope, current diff, and current
session. No approval implies any later approval.** Approval expires when the scope changes, the diff
materially changes, an unapproved file becomes involved, the repository state changes unexpectedly, the
session ends, or the owner revokes or replaces it. **Ambiguous wording is not approval** — "go ahead" and
"looks good" are not approval verbs; ask for the exact verb.

Required dependencies: `APPROVED TO MARK READY` needs an independent readiness verdict from a
non-implementer; `APPROVED TO MERGE` needs every merge condition in the PR body satisfied, plus recorded
runtime evidence (or an explicit owner waiver in the same message) where mobile/browser/installed-PWA/
physical-device testing is required. Static testing never satisfies a runtime requirement. Production
verification is separate from merge; branch cleanup follows recorded production verification. Agents may
not modify their own definitions without `APPROVED TO MODIFY AGENTS`.

> Full definitions, expiry rules, and dependencies:
> [`.claude/FUTURO-AGENT-GOVERNANCE.md`](.claude/FUTURO-AGENT-GOVERNANCE.md) §34–§35, which controls.

## 9. Source-Control Restrictions

- No autonomous `commit`, `push`, `pull`, `checkout`, or `merge`.
- `git add` is limited to explicitly approved files; adding files outside approved scope requires approval.
- **Do not force-track locally excluded configuration.** `git add -f` (or any other forced tracking) of
  `CLAUDE.md` or anything under `.claude/` is prohibited unless the owner provides explicit approval.
- Read-only git inspection (`status`, `fetch`, `check-ignore`, `ls-remote`, `rev-list`) is permitted.
- Do not edit `.gitignore`, `.git/info/exclude`, or other ignore/exclude configuration without approval.

## 10. Production Restrictions

- No deploy, migration, schema change, RLS change, production-data change, or production
  environment-variable change without owner approval.
- **Do not manually deploy Netlify from the local working directory** when the deployment could include
  locally excluded Claude configuration, governance, backup, settings, or agent files. Deployment must go
  through the approved GitHub → Netlify path so excluded local files never leave the working directory.
- Every production change requires testing, evidence, approval, and rollback readiness.

## 11. Security & Secret-Handling Rules

- Never place secrets in code, logs, commits, or agent memory.
- Never expose unrestricted terminal, filesystem, credential, deployment, or database access through the PWA.
- Treat credentials, customer information, health information, government-sensitive information, production
  records, and private communications as protected — never persist them in agent memory.

## 12. Testing Requirements

- Verify at **runtime**, not only by static inspection.
- Mobile/PWA behavior must be verified on the supported environments in both signed-out and authenticated
  states; desktop emulation alone cannot certify physical-device behavior.
- **The agent implementing a change cannot independently provide the final production-readiness verdict for
  that same change** (implementer ≠ certifier).

## 13. Agent Delegation Principles

- Work is coordinated across authority classes: Coordination, Planning, Architecture, Implementation,
  Auditor, Testing, and Release. See the matrix for the 16 installed agents.
- `futuro-orchestrator` is a read-only coordination layer. In P1/manual-only
  mode it may recommend sequencing and handoffs, but it cannot invoke agents;
  the owner manually launches each agent and transfers each handoff.
- Every agent produces the **Standard Agent Result Format** defined in the governance document.
- **MCP uses an explicit per-agent allowlist.** Only `futuro-orchestrator`,
  `futuro-app-architect`, `futuro-task-planner`, and
  `futuro-workflow-architect` may use the eight approved retrieval-only
  `codebase-memory-mcp` tools declared in their frontmatter. Indexing,
  persistent-state mutation, arbitrary Cypher, deletion, Supabase MCP, and all
  other MCP access remain denied.
- The controlled MCP hook enforces the pilot-agent and exact-tool boundary.
  When the index is unavailable, stale, or insufficient, agents fall back to
  `Read`, `Grep`, and `Glob`; they never auto-index.
- n8n is the approved future workflow-automation platform, but no n8n MCP,
  workflow execution, webhook, credential use, message, schedule, or external
  action is configured or authorized in this pilot.
- **No persistent agent memory** during the setup and pilot period.
- Agents cannot autonomously perform any owner-approval-gated action (§8).

## 14. References

- Governance & policy detail: [`.claude/FUTURO-AGENT-GOVERNANCE.md`](.claude/FUTURO-AGENT-GOVERNANCE.md)
- Planned agent roster & authority matrix: [`.claude/FUTURO-AGENT-MATRIX.md`](.claude/FUTURO-AGENT-MATRIX.md)
