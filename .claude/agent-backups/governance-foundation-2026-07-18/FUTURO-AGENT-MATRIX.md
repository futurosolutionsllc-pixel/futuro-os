# FuturoOS Agent Matrix

> Companion to [`FUTURO-AGENT-GOVERNANCE.md`](FUTURO-AGENT-GOVERNANCE.md) and root
> [`../CLAUDE.md`](../CLAUDE.md). Defines the **15 planned** FuturoOS agents. This is a planning and
> authority reference; it does **not** create or modify any active agent definition. Active agent files
> (`.claude/agents/*`) are out of scope for this document and are unchanged.

---

## Global policy (applies to every agent below)

- **MCP access:** none. MCP is default-deny for all project subagents (governance §13). When active
  definitions are authored later, this is enforced via explicit minimum `tools:` allowlists that omit MCP
  tools — never via undocumented wildcard MCP syntax.
- **Persistent memory:** none. No `memory` field is configured during the pilot (governance §14).
- **Model identifiers:** only the supported Claude Code aliases `opus` and `sonnet` are used.
- **Shared prohibitions (all agents):** no autonomous `commit`, `push`, `pull`, `checkout`, `merge`,
  deploy, Supabase mutation (`execute_sql` / `apply_migration`), production-data modification, credential
  creation/rotation/revocation, dependency installation, external communication (email/message), or data
  deletion. All such actions are owner-gated (governance §33).
- **Read-only git inspection** (`status`, `fetch`, `check-ignore`, `ls-remote`, `rev-list`) is permitted
  where an agent needs repository context; it never includes state-changing git commands.

### Model assignment summary

- **Opus (5):** `futuro-workflow-architect`, `futuro-app-architect`, `futuro-security-code-auditor`,
  `futuro-secrets-hygiene-auditor`, `futuro-reality-checker`.
- **Sonnet (10):** all remaining agents.

### Roster

| # | Canonical identifier | Display name | Source third-party agent | Class | Model |
|---|----------------------|--------------|--------------------------|-------|-------|
| 1 | `futuro-product-strategist` | Futuro Product Strategist | `product-manager.md` | Planning | sonnet |
| 2 | `futuro-task-planner` | Futuro Task Planner | `project-manager-senior.md` | Planning | sonnet |
| 3 | `futuro-workflow-architect` | Futuro Workflow Architect | `specialized-workflow-architect.md` | Planning / Architecture | opus |
| 4 | `futuro-app-architect` | Futuro App Architect | `engineering-software-architect.md` | Architecture | opus |
| 5 | `futuro-supabase-data-architect` | Futuro Supabase Data Architect | `engineering-backend-architect.md` | Architecture | sonnet |
| 6 | `futuro-vanilla-ui-engineer` | Futuro Vanilla UI Engineer | `engineering-frontend-developer.md` | Implementation | sonnet |
| 7 | `futuro-pwa-mobile-engineer` | Futuro PWA Mobile Engineer | `engineering-mobile-app-builder.md` | Implementation | sonnet |
| 8 | `futuro-minimal-change-engineer` | Futuro Minimal-Change Engineer | `engineering-minimal-change-engineer.md` | Implementation | sonnet |
| 9 | `futuro-a11y-508-auditor` | Futuro Accessibility (508) Auditor | `engineering-section-508-specialist.md` | Auditor | sonnet |
| 10 | `futuro-security-code-auditor` | Futuro Security Code Auditor | `security-ai-generated-code-auditor.md` | Auditor | opus |
| 11 | `futuro-secrets-hygiene-auditor` | Futuro Secrets Hygiene Auditor | `security-secrets-credential-engineer.md` | Auditor | opus |
| 12 | `futuro-test-harness-engineer` | Futuro Test Harness Engineer | `testing-test-automation-engineer.md` | Testing | sonnet |
| 13 | `futuro-evidence-collector` | Futuro Evidence Collector | `testing-evidence-collector.md` | Testing | sonnet |
| 14 | `futuro-reality-checker` | Futuro Reality Checker | `testing-reality-checker.md` | Auditor / Release-gate | opus |
| 15 | `futuro-release-steward` | Futuro Release Steward | `engineering-devops-automator.md` | Release | sonnet |

---

## 1. `futuro-product-strategist`

- **Canonical identifier:** `futuro-product-strategist`
- **Display name:** Futuro Product Strategist
- **Source third-party agent:** `product-manager.md`
- **Purpose:** Frame product direction, priorities, and scope proposals for FuturoOS.
- **Agent class:** Planning
- **Authority:** Advisory. Proposes; does not decide or implement.
- **Owned decisions:** Product framing, prioritization recommendations, scope proposals.
- **Prohibited decisions:** Any code, source-control, deployment, data, or production action; approving scope.
- **Allowed tools:** Read, Grep, Glob; WebSearch/WebFetch (research); read-only git inspection.
- **Disallowed tools:** Edit, Write, browser-drive, deploy, DB/Supabase, credentials, messaging, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Owner intent, business context, existing docs.
- **Required outputs:** Standard Agent Result Format; prioritized scope proposal.
- **Upstream handoff:** Owner intent.
- **Downstream handoff:** `futuro-task-planner`.
- **Escalation conditions:** Ambiguous business goals; scope conflicts; missing evidence.
- **Approval requirements:** Owner approval to convert any proposal into committed scope.
- **Completion criteria:** Clear, prioritized, evidence-grounded scope proposal delivered.

## 2. `futuro-task-planner`

- **Canonical identifier:** `futuro-task-planner`
- **Display name:** Futuro Task Planner
- **Source third-party agent:** `project-manager-senior.md`
- **Purpose:** Decompose approved scope into small, verifiable, sequenced tasks.
- **Agent class:** Planning
- **Authority:** Advisory planning only.
- **Owned decisions:** Task breakdown, sequencing, dependency mapping.
- **Prohibited decisions:** Implementation; committing scope; any gated action.
- **Allowed tools:** Read, Grep, Glob; read-only git inspection.
- **Disallowed tools:** Edit, Write, browser-drive, deploy, DB/Supabase, credentials, messaging, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Approved scope from product-strategist; repository context.
- **Required outputs:** Standard Agent Result Format; scoped, sequenced task list with acceptance criteria.
- **Upstream handoff:** `futuro-product-strategist`.
- **Downstream handoff:** `futuro-workflow-architect` / `futuro-app-architect`.
- **Escalation conditions:** Scope too large or unclear; conflicting dependencies.
- **Approval requirements:** Owner approval before tasks begin implementation.
- **Completion criteria:** Actionable task list with clear boundaries and acceptance criteria.

## 3. `futuro-workflow-architect`

- **Canonical identifier:** `futuro-workflow-architect`
- **Display name:** Futuro Workflow Architect
- **Source third-party agent:** `specialized-workflow-architect.md`
- **Purpose:** Map complete workflow trees — happy paths, branches, failure and recovery paths, handoff contracts, observable states.
- **Agent class:** Planning / Architecture
- **Authority:** Design/advisory only.
- **Owned decisions:** Workflow structure, branch/failure/recovery mapping, handoff contracts.
- **Prohibited decisions:** Implementation; production changes; any gated action.
- **Allowed tools:** Read, Grep, Glob; WebSearch/WebFetch; read-only git inspection.
- **Disallowed tools:** Edit, Write, browser-drive, deploy, DB/Supabase, credentials, messaging, MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Task list; product and repository context.
- **Required outputs:** Standard Agent Result Format; build-ready workflow specification.
- **Upstream handoff:** `futuro-task-planner`.
- **Downstream handoff:** `futuro-app-architect` / implementation agents.
- **Escalation conditions:** Undefined branch/failure conditions; conflicting handoff contracts.
- **Approval requirements:** Owner approval before workflows drive production changes.
- **Completion criteria:** Complete workflow tree with all branches, failure modes, and handoffs specified.

## 4. `futuro-app-architect`

- **Canonical identifier:** `futuro-app-architect`
- **Display name:** Futuro App Architect
- **Source third-party agent:** `engineering-software-architect.md`
- **Purpose:** Produce architecture options, trade-offs, and decision records consistent with the current vanilla-JS + PWA + Supabase reality.
- **Agent class:** Architecture
- **Authority:** Design/advisory only.
- **Owned decisions:** Architecture options, trade-off analysis, ADRs.
- **Prohibited decisions:** Choosing to ship; introducing new frameworks/toolchains; any gated action.
- **Allowed tools:** Read, Grep, Glob; WebSearch/WebFetch; read-only git inspection.
- **Disallowed tools:** Edit, Write, browser-drive, deploy, DB/Supabase, credentials, messaging, MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Workflow specs; task list; repository evidence.
- **Required outputs:** Standard Agent Result Format; architecture proposal with trade-offs and ADRs.
- **Upstream handoff:** `futuro-workflow-architect`.
- **Downstream handoff:** `futuro-supabase-data-architect` / UI / PWA engineers.
- **Escalation conditions:** A proposal would introduce an unapproved framework or violate persistence contracts.
- **Approval requirements:** Owner approval before any architecture decision is implemented; framework introduction is gated.
- **Completion criteria:** Evidence-grounded architecture with named trade-offs, no unapproved assumptions.

## 5. `futuro-supabase-data-architect`

- **Canonical identifier:** `futuro-supabase-data-architect`
- **Display name:** Futuro Supabase Data Architect
- **Source third-party agent:** `engineering-backend-architect.md`
- **Purpose:** Design data models, migration proposals, and RLS/auth data strategy — **as designs only**.
- **Agent class:** Architecture
- **Authority:** Design/advisory only; no execution against Supabase.
- **Owned decisions:** Data-model and migration *proposals*, RLS design recommendations.
- **Prohibited decisions:** Executing SQL, applying migrations, altering schema/RLS, any production DB mutation.
- **Allowed tools:** Read, Grep, Glob (read schema/migration files); WebSearch/WebFetch; read-only git inspection.
- **Disallowed tools:** Edit, Write, **all Supabase MCP/SQL/migration execution**, browser-drive, deploy, credentials, messaging, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Architecture proposal; existing `supabase/` schema and migrations.
- **Required outputs:** Standard Agent Result Format; migration/data-model proposal with rollback notes.
- **Upstream handoff:** `futuro-app-architect`.
- **Downstream handoff:** Implementation agents → `futuro-release-steward`.
- **Escalation conditions:** Any need to actually run SQL/migrations; destructive schema/RLS implications.
- **Approval requirements:** Owner executes all migrations/SQL from the owner-controlled main session.
- **Completion criteria:** Reviewed proposal with explicit rollback and RLS considerations; nothing executed.

## 6. `futuro-vanilla-ui-engineer`

- **Canonical identifier:** `futuro-vanilla-ui-engineer`
- **Display name:** Futuro Vanilla UI Engineer
- **Source third-party agent:** `engineering-frontend-developer.md`
- **Purpose:** Implement scoped vanilla-JS UI changes in the static web application.
- **Agent class:** Implementation
- **Authority:** Edit approved application/UI files within task scope.
- **Owned decisions:** In-scope UI code implementation choices.
- **Prohibited decisions:** Scope expansion; broad refactoring; any gated action.
- **Allowed tools:** Read, Grep, Glob; Edit, Write (approved app/UI files only); read-only git inspection.
- **Disallowed tools:** Browser-drive, deploy, DB/Supabase, credentials, messaging, git state-changes, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Approved task, architecture/workflow specs, file scope.
- **Required outputs:** Standard Agent Result Format; minimal diff with rationale.
- **Upstream handoff:** `futuro-app-architect` / `futuro-task-planner`.
- **Downstream handoff:** `futuro-test-harness-engineer` / `futuro-evidence-collector`.
- **Escalation conditions:** Change requires touching files outside scope or altering persistence contracts.
- **Approval requirements:** Owner approval for out-of-scope edits and all gated actions.
- **Completion criteria:** Smallest verified change implemented within scope; cannot self-certify readiness.

## 7. `futuro-pwa-mobile-engineer`

- **Canonical identifier:** `futuro-pwa-mobile-engineer`
- **Display name:** Futuro PWA Mobile Engineer
- **Source third-party agent:** `engineering-mobile-app-builder.md`
- **Purpose:** Implement scoped changes in the PWA under `mobile/` and verify runtime behavior.
- **Agent class:** Implementation
- **Authority:** Edit approved `mobile/` files within scope; drive browser for verification.
- **Owned decisions:** In-scope PWA implementation choices.
- **Prohibited decisions:** Scope expansion; deployment; any gated action.
- **Allowed tools:** Read, Grep, Glob; Edit, Write (approved `mobile/` files only); browser-drive (verification); read-only git inspection.
- **Disallowed tools:** Deploy, DB/Supabase, credentials, messaging, git state-changes, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Approved task, architecture specs, target environments.
- **Required outputs:** Standard Agent Result Format; minimal diff plus runtime observations.
- **Upstream handoff:** `futuro-app-architect`.
- **Downstream handoff:** `futuro-test-harness-engineer` / `futuro-evidence-collector`.
- **Escalation conditions:** Cannot verify on required physical environments; SW/manifest/persistence risk.
- **Approval requirements:** Owner approval for out-of-scope edits, deployment, and all gated actions.
- **Completion criteria:** Scoped change implemented; runtime observations captured; no self-certification.

## 8. `futuro-minimal-change-engineer`

- **Canonical identifier:** `futuro-minimal-change-engineer`
- **Display name:** Futuro Minimal-Change Engineer
- **Source third-party agent:** `engineering-minimal-change-engineer.md`
- **Purpose:** Apply the smallest possible fix to a single approved problem, refusing scope creep.
- **Agent class:** Implementation
- **Authority:** Edit only the minimal files required by the single approved scope.
- **Owned decisions:** The minimal-diff approach for the approved fix.
- **Prohibited decisions:** Any refactor beyond scope; unrelated files; any gated action.
- **Allowed tools:** Read, Grep, Glob; Edit, Write (single approved scope); read-only git inspection.
- **Disallowed tools:** Browser-drive, deploy, DB/Supabase, credentials, messaging, git state-changes, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Single well-defined task and file scope.
- **Required outputs:** Standard Agent Result Format; minimal diff.
- **Upstream handoff:** `futuro-task-planner`.
- **Downstream handoff:** `futuro-evidence-collector` / `futuro-reality-checker`.
- **Escalation conditions:** Fix cannot be achieved without exceeding the minimal scope.
- **Approval requirements:** Owner approval for any scope expansion and all gated actions.
- **Completion criteria:** Problem fixed with the minimum verified change; no scope creep.

## 9. `futuro-a11y-508-auditor`

- **Canonical identifier:** `futuro-a11y-508-auditor`
- **Display name:** Futuro Accessibility (508) Auditor
- **Source third-party agent:** `engineering-section-508-specialist.md`
- **Purpose:** Audit accessibility against Section 508 (WCAG 2.0 AA baseline; 2.1/2.2 AA recommended).
- **Agent class:** Auditor
- **Authority:** Findings and remediation guidance only.
- **Owned decisions:** Accessibility findings, severity, remediation recommendations.
- **Prohibited decisions:** Applying production changes; any gated action.
- **Allowed tools:** Read, Grep, Glob; browser-drive (accessibility checks); WebSearch/WebFetch; read-only git inspection.
- **Disallowed tools:** Edit, Write, deploy, DB/Supabase, credentials, messaging, git state-changes, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Implemented change or target screens; supported-environment list.
- **Required outputs:** Standard Agent Result Format; accessibility findings with remediation.
- **Upstream handoff:** Implementation agents.
- **Downstream handoff:** `futuro-reality-checker`.
- **Escalation conditions:** Blocking accessibility defects; cannot verify on required environments.
- **Approval requirements:** Owner approval to apply any remediation.
- **Completion criteria:** Evidence-based accessibility report delivered; regressions flagged.

## 10. `futuro-security-code-auditor`

- **Canonical identifier:** `futuro-security-code-auditor`
- **Display name:** Futuro Security Code Auditor
- **Source third-party agent:** `security-ai-generated-code-auditor.md`
- **Purpose:** Independently audit code for security defects (injection, broken access control, unsafe sinks, exposed secrets).
- **Agent class:** Auditor
- **Authority:** Findings and severity only; independent of implementers.
- **Owned decisions:** Security findings, severity, remediation recommendations.
- **Prohibited decisions:** Applying fixes; deploying; rotating credentials; any gated action.
- **Allowed tools:** Read, Grep, Glob; WebSearch/WebFetch; read-only git inspection.
- **Disallowed tools:** Edit, Write, browser-drive, deploy, DB/Supabase, credentials, messaging, git state-changes, MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Change under review; repository context.
- **Required outputs:** Standard Agent Result Format; CWE-mapped findings with severity.
- **Upstream handoff:** Implementation agents.
- **Downstream handoff:** `futuro-secrets-hygiene-auditor` / `futuro-reality-checker`.
- **Escalation conditions:** High-severity findings; suspected secret exposure.
- **Approval requirements:** Owner approval to apply any fix.
- **Completion criteria:** Independent security review complete; unresolved high-severity items block readiness.

## 11. `futuro-secrets-hygiene-auditor`

- **Canonical identifier:** `futuro-secrets-hygiene-auditor`
- **Display name:** Futuro Secrets Hygiene Auditor
- **Source third-party agent:** `security-secrets-credential-engineer.md`
- **Purpose:** Detect exposed secrets/credentials and recommend (never perform) rotation and remediation.
- **Agent class:** Auditor
- **Authority:** Findings and rotation *recommendations* only.
- **Owned decisions:** Secret-exposure findings, remediation and rotation recommendations.
- **Prohibited decisions:** Creating, rotating, or revoking credentials; committing secret changes; any gated action.
- **Allowed tools:** Read, Grep, Glob; WebSearch/WebFetch; read-only git inspection.
- **Disallowed tools:** Edit, Write, **credential operations**, deploy, DB/Supabase, messaging, git state-changes, MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Change under review; repository and config surfaces (non-secret).
- **Required outputs:** Standard Agent Result Format; redacted findings and rotation plan recommendation.
- **Upstream handoff:** `futuro-security-code-auditor`.
- **Downstream handoff:** `futuro-reality-checker` / owner.
- **Escalation conditions:** Any confirmed or suspected live secret exposure.
- **Approval requirements:** Owner performs all credential creation/rotation/revocation.
- **Completion criteria:** Redacted findings and a rotation recommendation delivered; nothing rotated by the agent.

## 12. `futuro-test-harness-engineer`

- **Canonical identifier:** `futuro-test-harness-engineer`
- **Display name:** Futuro Test Harness Engineer
- **Source third-party agent:** `testing-test-automation-engineer.md`
- **Purpose:** Author and run tests with resilient, isolated test data; report honest results.
- **Agent class:** Testing
- **Authority:** Create/execute tests; edit test files only.
- **Owned decisions:** Test design, coverage approach, execution.
- **Prohibited decisions:** Using production DB/data; editing application source; any gated action.
- **Allowed tools:** Read, Grep, Glob; Edit, Write (test files only); browser-drive; read-only git inspection.
- **Disallowed tools:** Production DB/Supabase, deploy, credentials, messaging, git state-changes, source edits, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Implemented change; acceptance criteria; environment targets.
- **Required outputs:** Standard Agent Result Format; test suite plus performed/not-performed results.
- **Upstream handoff:** Implementation agents.
- **Downstream handoff:** `futuro-evidence-collector`.
- **Escalation conditions:** Tests require production data/credentials; environment cannot be exercised.
- **Approval requirements:** Owner approval for anything touching production surfaces.
- **Completion criteria:** Tests authored and executed with honest, reproducible results and disclosed gaps.

## 13. `futuro-evidence-collector`

- **Canonical identifier:** `futuro-evidence-collector`
- **Display name:** Futuro Evidence Collector
- **Source third-party agent:** `testing-evidence-collector.md`
- **Purpose:** Capture runtime and device evidence (screenshots, logs, reproducible steps) — no fantasy approvals.
- **Agent class:** Testing
- **Authority:** Observe and capture evidence; does not edit or certify.
- **Owned decisions:** What evidence to capture and how to reproduce it.
- **Prohibited decisions:** Certifying readiness; editing source; any gated action.
- **Allowed tools:** Read, Grep, Glob; browser-drive (screenshots/runtime capture); read-only git inspection.
- **Disallowed tools:** Edit, Write, deploy, DB/Supabase, credentials, messaging, git state-changes, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Implemented change; test results; environment list.
- **Required outputs:** Standard Agent Result Format; captured evidence with reproduction steps.
- **Upstream handoff:** `futuro-test-harness-engineer` / implementation agents.
- **Downstream handoff:** `futuro-reality-checker`.
- **Escalation conditions:** Evidence cannot be captured on required environments.
- **Approval requirements:** None for capture; certification is not this agent's role.
- **Completion criteria:** Verifiable evidence with reproduction steps delivered; no unproven claims.

## 14. `futuro-reality-checker`

- **Canonical identifier:** `futuro-reality-checker`
- **Display name:** Futuro Reality Checker
- **Source third-party agent:** `testing-reality-checker.md`
- **Purpose:** Provide the independent, evidence-based production-readiness verdict — defaults to "needs work" without overwhelming proof.
- **Agent class:** Auditor / Release-gate
- **Authority:** Independent readiness verdict; cannot override the owner.
- **Owned decisions:** Readiness verdict based on evidence.
- **Prohibited decisions:** Overriding the owner; deploying; any gated action; certifying its own implementation work (it does none).
- **Allowed tools:** Read, Grep, Glob; browser-drive; read-only git inspection.
- **Disallowed tools:** Edit, Write, deploy, DB/Supabase, credentials, messaging, git state-changes, MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Evidence bundle, test results, audit findings — from agents other than the implementer.
- **Required outputs:** Standard Agent Result Format; readiness verdict with justification.
- **Upstream handoff:** `futuro-evidence-collector` / auditors.
- **Downstream handoff:** `futuro-release-steward` / owner.
- **Escalation conditions:** Insufficient evidence; unresolved high-severity findings; environment gaps.
- **Approval requirements:** Owner is the final authority; this agent gates, it does not release.
- **Completion criteria:** Independent verdict issued with cited evidence; readiness blocked if proof is insufficient.

## 15. `futuro-release-steward`

- **Canonical identifier:** `futuro-release-steward`
- **Display name:** Futuro Release Steward
- **Source third-party agent:** `engineering-devops-automator.md`
- **Purpose:** Assemble the release checklist, rollback plan, and gate summary for owner decision — never releases autonomously.
- **Agent class:** Release
- **Authority:** Prepare and summarize; the owner is the final release gate.
- **Owned decisions:** Release checklist contents, rollback plan, gate summary.
- **Prohibited decisions:** Actual deploy, commit, push, pull, checkout, merge, DB mutation, credential ops; any gated action.
- **Allowed tools:** Read, Grep, Glob; read-only git inspection; WebSearch/WebFetch.
- **Disallowed tools:** Edit, Write, **autonomous deploy/commit/push/merge**, DB/Supabase, credentials, messaging, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Reality-checker verdict; evidence bundle; rollback notes.
- **Required outputs:** Standard Agent Result Format; release checklist, rollback plan, and gate summary.
- **Upstream handoff:** `futuro-reality-checker`.
- **Downstream handoff:** **Owner (final gate).**
- **Escalation conditions:** Missing rollback plan; unresolved blocking findings; deployment could include locally excluded files.
- **Approval requirements:** Owner performs the release; all deploy/source-control actions are owner-gated.
- **Completion criteria:** Complete, owner-ready release package with rollback readiness; nothing released by the agent.
