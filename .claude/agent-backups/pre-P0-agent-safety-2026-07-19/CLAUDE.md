# FuturoOS — Claude Code Project Instructions

> **Authoritative project instruction file.** Read this every session. It is intentionally concise;
> detailed policy lives in [`.claude/FUTURO-AGENT-GOVERNANCE.md`](.claude/FUTURO-AGENT-GOVERNANCE.md)
> and the agent roster lives in [`.claude/FUTURO-AGENT-MATRIX.md`](.claude/FUTURO-AGENT-MATRIX.md).
> Where this file and the governance document agree, both bind. Where more detail is needed, the
> governance document controls.

---

## 1. Business Identity

- **Futuro Solutions LLC** — the legal entity.
- **Futuro Transport** — its DBA and logistics / secure-courier operating branch.
- **FuturoOS** — the unified internal operating platform.
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

- Work is delegated across authority classes: Planning, Architecture, Implementation, Auditor, Testing,
  Release. See the matrix for the 15 planned agents.
- Every agent produces the **Standard Agent Result Format** defined in the governance document.
- **MCP is default-deny** for all project subagents; Supabase and other MCP access remain with the
  owner-controlled main session unless separately approved.
- **No persistent agent memory** during the setup and pilot period.
- Agents cannot autonomously perform any owner-approval-gated action (§8).

## 14. References

- Governance & policy detail: [`.claude/FUTURO-AGENT-GOVERNANCE.md`](.claude/FUTURO-AGENT-GOVERNANCE.md)
- Planned agent roster & authority matrix: [`.claude/FUTURO-AGENT-MATRIX.md`](.claude/FUTURO-AGENT-MATRIX.md)
