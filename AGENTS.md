# OpenHuli agent instructions

OpenHuli is an open-source project maintained by one person. Prefer changes that are easy to
understand, test, and maintain. Keep process proportional to the work.

## Working agreement

- A clear user request is enough to start. Use an existing issue when supplied; do not require
  a new issue, assignee, project status, or separate reviewer for every change.
- Keep one short task diary for implementation work at `tasks/<short-description>.md`, using
  [the template](tasks/TEMPLATE.md). Record the goal, useful decisions, actual check results, and
  remaining work. Reuse it across follow-ups; no diary is needed for read-only questions or reviews.
- Inspect the current implementation, complete request flow, callers, and tests before editing.
  Read relevant architecture notes under `docs/architecture/`; these rules take precedence over
  stale scaffold guidance. Planned MVP capabilities are not proof of implemented behavior.
- Keep changes scoped and preserve unrelated local work. Prefer existing dependencies and
  patterns; justify additions by the problem they solve.
- For a new implementation branch, use `codex/<short-description>` unless directed otherwise.
  Verify the intended base and dependency changes; reviews and small documentation edits do not
  require a new branch. Do not commit, push, merge, publish, or deploy unless requested.
- Use English for repository content and GitHub contributions. Keep secrets, credentials,
  personal data, and machine-specific paths out of committed files and shared evidence.
- Prefer an available CLI or API for external services. Use existing authorization without
  asking again; ask only for missing decisions or permissions that materially affect the task.

## Architecture

- Identify the feature that owns the change. Use `packages/modules/todos` as the reference
  structure for simple features, keeping schemas, types, repositories, and use cases close together.
- Keep explicit use cases. Routes, UI, and AI tools must call them rather than bypass business
  rules. Do not import Prisma outside repository or persistence code.
- Keep simple CRUD simple: no full DDD layering, speculative framework, or abstraction for a
  single trivial implementation. Keep ports for external or volatile boundaries.
- Use **Tenant**, never Workspace. Do not introduce Platform, Workspace, or generic Automation
  domains. Preserve authorization and tenant isolation on reads, writes, retries, and errors.
- Validate untrusted input at the boundary; use precise types rather than `any`, unchecked casts,
  or suppressions. AI output and device claims are untrusted input, not authorization.

## Repository map

- `apps/app`: Next.js pages, UI modules, server composition, and synchronous API routes.
- `packages/modules/*`: feature use cases and repositories.
- `packages/contracts`: shared request/response schemas.
- `packages/data/prisma`: database schema and migrations.
- `packages/ui`: shared UI components; `apps/e2e`: Playwright tests.
- Package scopes still use `@corely/*`; do not rename them as unrelated cleanup.

## Data and configuration

- Update configuration validation, `.env.example`, and affected setup/deployment documentation
  together when environment variables change. Do not copy private infrastructure from other repos.
- Use migrations for schema changes. Verify the database target before any mutation; development
  migrations and destructive tests use a disposable local database. Do not use `prisma db push`
  as a shortcut. Remote migrations, resets, and restores need authorization for that exact action.
- Preserve data and migration compatibility. For external effects, handle retries, duplicate
  delivery, cancellation, and uncertain outcomes without silently repeating writes.

## Verification and handoff

Run commands from the repository root with the Node and pnpm versions declared in `package.json`.
For application changes, add or update meaningful behavior tests and run:

```sh
pnpm typecheck
pnpm test
pnpm --filter @corely/data exec prisma validate
pnpm arch:check
pnpm build
```

Run affected tests first and lint where applicable. Inspect scripts/configuration before running
integration or E2E suites; report missing setup rather than claiming coverage from a skipped run.
For documentation or skill-only changes, check formatting, links, skill metadata, and the diff;
runtime checks are unnecessary unless executable behavior changes.

Self-review the complete diff and update the task diary. Fix failures introduced by the change; report unrelated baseline
failures without expanding scope or weakening checks. Summarize the result, changed files, actual
verification, and remaining risks. The maintainer may self-review; honor configured repository
checks and branch protection. Draft PRs are useful for incomplete work, not mandatory for every PR.

## Reusable skills

Read only the skill relevant to the current task. These workflows are adapted from TruckerPoints
for OpenHuli; they require no private handbook, account, cloud provider, or additional maintainer.

| Task                                | Skill                                                                |
| ----------------------------------- | -------------------------------------------------------------------- |
| Implement an issue or clear request | [implement-ticket](.agents/skills/implement-ticket/SKILL.md)         |
| Diagnose and fix a defect           | [bug-fix](.agents/skills/bug-fix/SKILL.md)                           |
| Break down oversized work           | [split-ticket](.agents/skills/split-ticket/SKILL.md)                 |
| Prepare a PR                        | [prepare-pull-request](.agents/skills/prepare-pull-request/SKILL.md) |
| Review a diff                       | [code-review](.agents/skills/code-review/SKILL.md)                   |
| Change user-visible UI              | [ui-change](.agents/skills/ui-change/SKILL.md)                       |
| Add browser coverage                | [create-e2e-test](.agents/skills/create-e2e-test/SKILL.md)           |
| Review security boundaries          | [security-audit](.agents/skills/security-audit/SKILL.md)             |
| Release, deploy, or roll back       | [release](.agents/skills/release/SKILL.md)                           |
