# FuturoOS Agent Matrix

> Companion to
> [`FUTURO-AGENT-GOVERNANCE.md`](FUTURO-AGENT-GOVERNANCE.md) and root
> [`../CLAUDE.md`](../CLAUDE.md). Documents the **16 installed, active**
> FuturoOS agent definitions under `.claude/agents/*`. This is the current
> authority and routing reference; it does **not** itself create, invoke, or
> execute an agent.
>
> **Operating mode:** autonomous orchestration is disabled (P1/manual-only).
> The owner manually launches every agent and manually transfers every handoff.
> Each downstream agent named below is an owner-routing recommendation, never
> an autonomous invocation (Governance §36).
>
> **Installation versus smoke tests:** the owner has reported that the original
> 15 specialist agents completed individual smoke tests (owner-supplied result).
> Static file inspection confirms installation and definition contents only;
> it does not independently reproduce those smoke tests. The newly installed
> `futuro-orchestrator` requires its own post-install smoke test.
>
> The canonical 17-field structured handoff contract is defined in
> [`FUTURO-AGENT-GOVERNANCE.md`](FUTURO-AGENT-GOVERNANCE.md) §30 and is
> referenced, not duplicated, here.

---

## Global policy (applies to every agent below)

- **Operating mode:** P1/manual-only. Autonomous orchestration is disabled;
  the owner manually launches every agent and transfers every handoff
  (Governance §36).
- **Installed tools:** eight agents declare `Read, Grep, Glob`; four
  controlled-MCP pilot agents declare `Read, Grep, Glob, ToolSearch` plus eight
  exact retrieval-only `codebase-memory-mcp` tools; four implementation agents
  declare `Read, Grep, Glob, Edit, Write`. No agent declares Task, Bash,
  WebSearch, WebFetch, browser automation, n8n, Supabase MCP, mutation-capable
  MCP, or agent-executed Git.
- **MCP access:** only `futuro-orchestrator`, `futuro-app-architect`,
  `futuro-task-planner`, and `futuro-workflow-architect` receive the controlled
  retrieval-only codebase-memory allowlist. Frontmatter, project permissions,
  server restrictions, and the controlled MCP hook enforce the exact
  agent-and-tool boundary (Governance §§13, 37, 42).
- **Persistent memory:** none. No installed definition configures a `memory`
  field (Governance §14).
- **Model identifiers:** only the supported Claude Code aliases `opus` and
  `sonnet` are used.
- **Shared prohibitions:** no autonomous `commit`, `push`, `pull`, `checkout`,
  `merge`, deployment, Supabase mutation, production-data modification,
  credential operations, dependency installation, external communication, or
  deletion. All such actions remain owner-gated (Governance §33).
- **Execution evidence:** no installed agent can execute Git commands, shell
  commands, tests, servers, browsers, deployments, database mutations, or
  live-service actions. The four pilot agents may execute only approved
  retrieval-only codebase-memory calls, which remain indexed retrieval
  evidence—not runtime or live-service proof. Other required execution
  evidence is owner-supplied or supplied by another independently authorized
  source (Governance §38).
- **Write scope:** the four Edit/Write-capable agents remain bound by both the
  technically enforced non-protected repository scope and the narrower
  owner-approved task/file scope. Only one implementation writer operates on
  a task at a time (Governance §39).
- **Enforcement layering:** frontmatter, settings, the PreToolUse hook, and
  procedural owner-approved scope can each restrict further. The narrowest
  effective restriction governs (Governance §37).

### Model assignment summary

- **Opus (6):** `futuro-orchestrator`, `futuro-workflow-architect`,
  `futuro-app-architect`, `futuro-security-code-auditor`,
  `futuro-secrets-hygiene-auditor`, `futuro-reality-checker`.
- **Sonnet (10):** all remaining agents.

### Coordination layer

| # | Canonical identifier | Display name | Source third-party agent | Class | Model |
|---|----------------------|--------------|--------------------------|-------|-------|
| 0 | `futuro-orchestrator` | Futuro Orchestrator | Native FuturoOS governance role | Coordination | opus |

### Specialist roster

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

## 0. `futuro-orchestrator`

- **Canonical identifier:** `futuro-orchestrator`
- **Display name:** Futuro Orchestrator
- **Source third-party agent:** Native FuturoOS governance role.
- **Purpose:** Coordinate task intake, specialist routing, sequencing, handoff
  completeness, evidence gaps, approval gates, and owner stop points.
- **Agent class:** Coordination
- **Authority:** Read-only coordination and owner-routing recommendations only.
- **Owned decisions:** Smallest valid agent-chain recommendation, sequence,
  dependencies, handoff validation, and orchestration-ledger maintenance.
- **Prohibited decisions:** Invoking agents; editing files; executing commands;
  approving scope or gated actions; certifying readiness; releasing; overriding
  specialist, Reality Checker, Release Steward, hook, governance, or owner authority.
- **Allowed tools (installed frontmatter):** Read, Grep, Glob,
  ToolSearch, and the eight exact retrieval-only
  `codebase-memory-mcp` tools defined in Governance §13.
- **Disallowed tools:** Task, Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  all non-allowlisted MCP, MCP indexing/persistent-state mutation, n8n,
  and memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Owner request; available specialist handoffs; repository
  evidence; owner-supplied execution evidence.
- **Required outputs:** Standard Agent Result Format with the 12-field
  orchestration ledger embedded in field 7.
- **Upstream handoff:** Owner or any installed specialist agent.
- **Downstream handoff:** Owner-routed specialist agent only.
- **Escalation conditions:** Ambiguous or expanding scope; conflicting handoffs;
  missing evidence; a gated action; any attempt to bypass independence or P1
  manual-only operation.
- **Approval requirements:** Cannot grant approval. The owner supplies every
  required approval verb and manually launches every downstream agent.
- **Completion criteria:** Smallest valid governed route is documented; required
  inputs, evidence, approvals, owner action, stop condition, and next agent are
  explicit; no delegation or execution occurred.

## 1. `futuro-product-strategist`

- **Canonical identifier:** `futuro-product-strategist`
- **Display name:** Futuro Product Strategist
- **Source third-party agent:** `product-manager.md`
- **Purpose:** Frame product direction, priorities, and scope proposals for FuturoOS.
- **Agent class:** Planning
- **Authority:** Advisory. Proposes; does not decide or implement.
- **Owned decisions:** Product framing, prioritization recommendations, scope proposals.
- **Prohibited decisions:** Any code, source-control, deployment, data, or production action; approving scope.
- **Allowed tools (installed frontmatter):** Read, Grep, Glob.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  MCP, memory.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob,
  ToolSearch, and the eight exact retrieval-only
  `codebase-memory-mcp` tools defined in Governance §13.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  all non-allowlisted MCP, MCP indexing/persistent-state mutation, n8n,
  and memory.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob,
  ToolSearch, and the eight exact retrieval-only
  `codebase-memory-mcp` tools defined in Governance §13.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  all non-allowlisted MCP, MCP indexing/persistent-state mutation, n8n,
  and memory.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob,
  ToolSearch, and the eight exact retrieval-only
  `codebase-memory-mcp` tools defined in Governance §13.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  all non-allowlisted MCP, MCP indexing/persistent-state mutation, n8n,
  and memory.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob
  (schema/migration files for design context only).
- **Disallowed tools:** Edit, Write, Bash, **all Supabase
  MCP/SQL/migration execution**, WebSearch, WebFetch, browser automation,
  agent-executed Git, deploy, credentials, messaging, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Architecture proposal; existing `supabase/` schema and migrations.
- **Required outputs:** Standard Agent Result Format; migration/data-model proposal with rollback notes.
- **Upstream handoff:** `futuro-app-architect`.
- **Downstream handoff:** Owner-routed implementation and verification chain.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob, Edit, Write.
- **Disallowed tools:** Bash, WebSearch, WebFetch, browser automation,
  agent-executed Git, deploy, DB/Supabase, credentials, messaging, MCP, memory.
- **Write scope (binding):** technical access is limited to in-repository,
  non-protected files. The owner-approved file list is an additional, narrower
  procedural limit. Only one implementation writer operates on a task.
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
- **Purpose:** Implement scoped PWA changes under `mobile/`; define verification needs.
- **Agent class:** Implementation
- **Authority:** Edit approved `mobile/` files within scope; no browser execution.
- **Owned decisions:** In-scope PWA implementation choices.
- **Prohibited decisions:** Scope expansion; deployment; any gated action.
- **Allowed tools (installed frontmatter):** Read, Grep, Glob, Edit, Write.
- **Disallowed tools:** Bash, WebSearch, WebFetch, browser automation,
  agent-executed Git, deploy, DB/Supabase, credentials, messaging, MCP, memory.
- **Write scope (binding):** technical access is limited to in-repository,
  non-protected files. The owner-approved file list is an additional, narrower
  procedural limit. Only one implementation writer operates on a task.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Approved task, architecture specs, target environments.
- **Required outputs:** Standard Agent Result Format; minimal diff and
  verification plan.
- **Upstream handoff:** `futuro-app-architect`.
- **Downstream handoff:** `futuro-test-harness-engineer` / `futuro-evidence-collector`.
- **Escalation conditions:** Cannot verify on required physical environments; SW/manifest/persistence risk.
- **Approval requirements:** Owner approval for out-of-scope edits, deployment, and all gated actions.
- **Completion criteria:** Scoped change implemented; verification gaps disclosed.

## 8. `futuro-minimal-change-engineer`

- **Canonical identifier:** `futuro-minimal-change-engineer`
- **Display name:** Futuro Minimal-Change Engineer
- **Source third-party agent:** `engineering-minimal-change-engineer.md`
- **Purpose:** Apply the smallest possible fix to a single approved problem, refusing scope creep.
- **Agent class:** Implementation
- **Authority:** Edit only the minimal files required by the single approved scope.
- **Owned decisions:** The minimal-diff approach for the approved fix.
- **Prohibited decisions:** Any refactor beyond scope; unrelated files; any gated action.
- **Allowed tools (installed frontmatter):** Read, Grep, Glob, Edit, Write.
- **Disallowed tools:** Bash, WebSearch, WebFetch, browser automation,
  agent-executed Git, deploy, DB/Supabase, credentials, messaging, MCP, memory.
- **Write scope (binding):** technical access is limited to in-repository,
  non-protected files. The owner-approved file list is an additional, narrower
  procedural limit. Only one implementation writer operates on a task.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Single well-defined task and file scope.
- **Required outputs:** Standard Agent Result Format; minimal diff.
- **Upstream handoff:** `futuro-task-planner`.
- **Downstream handoff:** `futuro-test-harness-engineer` / `futuro-evidence-collector`.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Implemented change or target screens; supported-environment list.
- **Required outputs:** Standard Agent Result Format; accessibility findings with remediation.
- **Upstream handoff:** Implementation agents.
- **Downstream handoff:** `futuro-evidence-collector`.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Change under review; repository context.
- **Required outputs:** Standard Agent Result Format; CWE-mapped findings with severity.
- **Upstream handoff:** Implementation agents.
- **Downstream handoff:** `futuro-secrets-hygiene-auditor` /
  `futuro-evidence-collector`.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, **credential operations**, deploy,
  DB/Supabase, messaging, MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Change under review; repository and config surfaces (non-secret).
- **Required outputs:** Standard Agent Result Format; redacted findings and rotation plan recommendation.
- **Upstream handoff:** `futuro-security-code-auditor`.
- **Downstream handoff:** `futuro-evidence-collector` / owner.
- **Escalation conditions:** Any confirmed or suspected live secret exposure.
- **Approval requirements:** Owner performs all credential creation/rotation/revocation.
- **Completion criteria:** Redacted findings and a rotation recommendation delivered; nothing rotated by the agent.

## 12. `futuro-test-harness-engineer`

- **Canonical identifier:** `futuro-test-harness-engineer`
- **Display name:** Futuro Test Harness Engineer
- **Source third-party agent:** `testing-test-automation-engineer.md`
- **Purpose:** Author approved tests and specify execution; report honest evidence.
- **Agent class:** Testing
- **Authority:** Create or edit approved test files only; no test execution.
- **Owned decisions:** Test design, coverage approach, and execution specification.
- **Prohibited decisions:** Using production DB/data; editing application source; any gated action.
- **Allowed tools (installed frontmatter):** Read, Grep, Glob, Edit, Write.
- **Disallowed tools:** Bash, WebSearch, WebFetch, browser automation,
  agent-executed Git, execution of tests/commands/servers, production
  DB/Supabase, deploy, credentials, messaging, application-source edits, MCP,
  memory.
- **Write scope (binding):** technical access is limited to in-repository,
  non-protected files. The owner-approved test-file list is an additional,
  narrower procedural limit. Only one implementation writer operates on a
  task. This agent may author approved test files but cannot execute tests.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Implemented change; acceptance criteria; environment targets.
- **Required outputs:** Standard Agent Result Format; tests, commands, and
  evidence needs.
- **Upstream handoff:** Implementation agents.
- **Downstream handoff:** `futuro-evidence-collector`.
- **Escalation conditions:** Tests require production data/credentials; environment cannot be exercised.
- **Approval requirements:** Owner approval for anything touching production surfaces.
- **Completion criteria:** Tests authored; owner-run execution and gaps
  labeled honestly.

## 13. `futuro-evidence-collector`

- **Canonical identifier:** `futuro-evidence-collector`
- **Display name:** Futuro Evidence Collector
- **Source third-party agent:** `testing-evidence-collector.md`
- **Purpose:** Organize static and owner-supplied runtime/device evidence.
- **Agent class:** Testing
- **Authority:** Inspect and organize available evidence; does not edit or certify.
- **Owned decisions:** Evidence requirements, organization, and reproduction steps.
- **Prohibited decisions:** Certifying readiness; editing source; any gated action.
- **Allowed tools (installed frontmatter):** Read, Grep, Glob.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Implemented change; test results; environment list.
- **Required outputs:** Standard Agent Result Format; labeled evidence bundle.
- **Upstream handoff:** `futuro-test-harness-engineer` / implementation agents.
- **Downstream handoff:** `futuro-reality-checker`.
- **Escalation conditions:** Evidence cannot be captured on required environments.
- **Approval requirements:** None for capture; certification is not this agent's role.
- **Completion criteria:** Labeled evidence and reproduction steps delivered.

## 14. `futuro-reality-checker`

- **Canonical identifier:** `futuro-reality-checker`
- **Display name:** Futuro Reality Checker
- **Source third-party agent:** `testing-reality-checker.md`
- **Purpose:** Provide an independent evidence-based readiness verdict.
- **Agent class:** Auditor / Release-gate
- **Authority:** Independent readiness verdict; cannot override the owner.
- **Owned decisions:** Readiness verdict based on evidence.
- **Prohibited decisions:** Overriding the owner; deploying; any gated action; certifying its own implementation work (it does none).
- **Allowed tools (installed frontmatter):** Read, Grep, Glob.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, deploy, DB/Supabase, credentials, messaging,
  MCP, memory.
- **Model:** opus
- **Memory:** none
- **Expected inputs:** Evidence bundle, test results, audit findings — from agents other than the implementer.
- **Required outputs:** Standard Agent Result Format; readiness verdict with justification.
- **Upstream handoff:** `futuro-evidence-collector` / auditors.
- **Downstream handoff:** `futuro-release-steward` / owner final authority.
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
- **Allowed tools (installed frontmatter):** Read, Grep, Glob.
- **Disallowed tools:** Edit, Write, Bash, WebSearch, WebFetch, browser
  automation, agent-executed Git, **autonomous deploy/commit/push/merge**,
  DB/Supabase, credentials, messaging, MCP, memory.
- **Model:** sonnet
- **Memory:** none
- **Expected inputs:** Reality-checker verdict; evidence bundle; rollback notes.
- **Required outputs:** Standard Agent Result Format; release checklist, rollback plan, and gate summary.
- **Upstream handoff:** `futuro-reality-checker`.
- **Downstream handoff:** **Owner (final gate).**
- **Escalation conditions:** Missing rollback plan; unresolved blocking findings; deployment could include locally excluded files.
- **Approval requirements:** Owner performs the release; all deploy/source-control actions are owner-gated.
- **Completion criteria:** Complete, owner-ready release package with rollback readiness; nothing released by the agent.
