# Simplify agent workflows for OpenHuli

## Goal

Adapt TruckerPoints' agent instructions and reusable skills for a single-maintainer open-source
project. Keep a useful task diary while removing unnecessary team process.

## Notes

- Preserve OpenHuli's feature ownership, explicit use cases, repository-owned Prisma access,
  Tenant terminology, authorization, isolation, and meaningful behavior tests.
- Adapt all nine source skills as short, self-contained workflows. Do not copy private account
  details, infrastructure, handbooks, audit pipelines, or deployment assumptions.
- Keep one task diary per implementation task. No mandatory issue creation, reviewer assignment,
  draft-only PRs, or multiple deployment stages.
- Follow-up requested by the maintainer: move a ticket to the project's existing In progress
  status before implementation; use its actual issue number in the branch, such as `02-foundation`;
  commit/push scoped work and open a PR after checks and self-review. Updated the implementation
  skill, PR skill, and root instructions together. Subsequent application of this workflow is recorded in each implementation diary.
- Changes affect instructions only; application behavior, dependencies, and runtime files are unchanged.

## Verification

- Skill creator's `quick_validate.py`: all nine skills passed. Used an isolated PyYAML environment;
  no project dependency changes were needed.
- Relative-link check: all 26 local links across the 12 changed/new documents resolved.
- Checked the documents for private source paths, account names, and infrastructure references;
  none were copied.
- Prettier 3.3.3 formatted all 12 documents. `git diff --check` and
  `node scripts/architecture-check.mjs` passed.
- Reviewed the full instructions and all nine adapted skills against the source workflows and
  OpenHuli's existing architecture rules. No runtime checks were run for this instructions-only change.
- Workflow follow-up: both changed skills passed metadata validation; all 17 local links resolved;
  formatting and whitespace checks passed. Existing foundation implementation changes were preserved.

## Remaining work / risks

None for the requested change. These instructions do not repair the scaffold's existing runtime
or E2E setup; those remain separate implementation work.
