---
name: implement-ticket
description: Implement an OpenHuli ticket from In progress through an issue-number branch, tested changes, and a pull request. Also supports clear implementation requests; excludes read-only planning and reviews.
---

# Implement a change

Follow [AGENTS.md](../../../AGENTS.md). A clear request is sufficient; an issue is helpful but
not mandatory. Create or reuse one short diary in `tasks/` from [the template](../../../tasks/TEMPLATE.md).

1. Read the requested outcome, acceptance criteria, and any supplied issue, parent, or dependencies.
   Check existing implementation and tests; identify the owning feature and trace its request flow.
2. Before editing for a ticket, inspect its project membership and existing Status options, then
   use the GitHub CLI to move it to **In progress** and verify the result. Add it to the supplied
   project if needed; OpenHuli's default is [Project 3](https://github.com/orgs/oneway8x-com/projects/3).
   Do not create a new status or silently substitute another project. If access fails, report the
   exact blocker and continue useful local work; do not claim the status changed.
3. Create or reuse `<issue-number>-<short-description>` from the verified intended base. Pad the
   actual GitHub issue number to at least two digits: #2 becomes `02-foundation`, #123 becomes
   `123-device-pairing`. Do not prefix it with `codex/`, use an MVP planning ID, invent an issue
   number for an issue-less request, or disturb unrelated local work. Record the issue and branch
   in the diary.
4. Choose the smallest useful change. Reuse the todo structure for simple features and keep
   business rules in explicit use cases. Resolve only ambiguities that would change the outcome.
5. Implement within scope and add tests that fail without the behavior. For a defect, apply
   [bug-fix](../bug-fix/SKILL.md); for visible UI, apply [ui-change](../ui-change/SKILL.md).
6. Check affected consumers, tenant isolation, and relevant failure paths. Update configuration
   examples and documentation when behavior or setup changes. Keep migrations compatible.
7. Run the checks in AGENTS.md, self-review the complete diff, and update the diary with useful
   decisions, actual results, and remaining work. Report actual failures or
   unavailable infrastructure; do not weaken assertions or expand into unrelated cleanup.
8. When implementation and required checks are complete, commit and push only the task's changes
   and create or update its PR using [prepare-pull-request](../prepare-pull-request/SKILL.md).
   This is part of completing implementation; do not wait for a second request to open the PR.
   Verify the PR's issue link, head/base, and returned URL, and save the URL in the diary. If push
   or PR creation fails, inspect actual state before retrying and report any incomplete handoff.

Finish with the PR link, outcome, affected files, test results, and remaining risks. Do not close
the ticket or mark it Done merely because a PR exists. Implementation does not authorize merging,
release, or deployment.
