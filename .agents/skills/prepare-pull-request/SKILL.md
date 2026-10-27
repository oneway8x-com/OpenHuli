---
name: prepare-pull-request
description: Prepare or update a concise OpenHuli pull request from the actual diff, issue scope, and verification results.
---

# Prepare a pull request

Follow [AGENTS.md](../../../AGENTS.md). Read the full diff, relevant issue or request, and actual
check results. Inspect any existing PR template and reuse it when present.

1. Verify the repository, head, and intended base. Include only the intended change; dependent
   work must not accidentally pull unrelated commits into the PR.
2. Self-review correctness, use-case boundaries, authorization, tenant scope, tests, and any
   migration/configuration effects. Resolve introduced defects before calling the work complete.
3. Write a short description covering the problem and resulting behavior, how it was tested,
   and material risks or limitations. Link the issue when one exists; use `Closes` only when
   the PR completes its scope. Add UI evidence when it helps verify the change.
4. Create or update the PR only when requested. Prefer the GitHub CLI; pass multiline text via
   a body file. Check for an existing PR before creating another and verify the returned state.
5. Use Draft for incomplete work or material unverified behavior. A complete PR needs no invented
   reviewer assignment; the sole maintainer can self-review subject to repository protections.

Update the existing task diary with the PR link and actual check results. Return the link and a
concise validation summary; keep investigation detail in the diary. PR creation does not authorize
merging, release, or deployment.
