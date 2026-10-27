---
name: implement-ticket
description: Implement an OpenHuli issue or clear feature request with focused changes and meaningful tests. Use for implementation, not read-only planning or reviews.
---

# Implement a change

Follow [AGENTS.md](../../../AGENTS.md). A clear request is sufficient; an issue is helpful but
not mandatory. Create or reuse one short diary in `tasks/` from [the template](../../../tasks/TEMPLATE.md).

1. Read the requested outcome, acceptance criteria, and any supplied issue, parent, or dependencies.
   Check existing implementation and tests; identify the owning feature and trace its request flow.
2. Choose the smallest useful change. Reuse the todo structure for simple features and keep
   business rules in explicit use cases. Resolve only ambiguities that would change the outcome.
3. Implement within scope and add tests that fail without the behavior. For a defect, apply
   [bug-fix](../bug-fix/SKILL.md); for visible UI, apply [ui-change](../ui-change/SKILL.md).
4. Check affected consumers, tenant isolation, and relevant failure paths. Update configuration
   examples and documentation when behavior or setup changes. Keep migrations compatible.
5. Run the checks in AGENTS.md, self-review the complete diff, and update the diary with useful
   decisions, actual results, and remaining work. Report actual failures or
   unavailable infrastructure; do not weaken assertions or expand into unrelated cleanup.

Finish with the outcome, affected files, test results, and remaining risks. Open a PR only when
requested, using [prepare-pull-request](../prepare-pull-request/SKILL.md). Implementation alone
does not authorize merging or deployment.
