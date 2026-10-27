---
name: code-review
description: Review an OpenHuli diff or pull request for actionable correctness, security, architecture, and regression problems. Use for requested code reviews, not implementation.
---

# Review a change

Follow [AGENTS.md](../../../AGENTS.md). Review-only work is read-only; return findings in the
conversation unless posting a review is requested.

1. Establish the actual head, base, requested behavior, and full diff. Read affected callers,
   contracts, and tests; distinguish the change from unrelated baseline debt.
2. Prioritize observable bugs, authorization and tenant isolation, data integrity, broken
   compatibility, and violations of OpenHuli's explicit use-case/persistence boundaries.
3. Inspect relevant error paths, retries, duplicate delivery, cancellation, and uncertain writes.
   Check types and input validation without imposing new abstractions on simple features.
4. Trace suspected defects to a reachable failure and run focused checks when useful. A missing
   test is actionable only when it leaves a specific meaningful behavior unprotected.
5. Report each material finding with a precise location, triggering condition, impact, and
   smallest reasonable correction. Separate verified findings from unresolved questions.

If there are no material findings, say so and state verification limits. Avoid style-only noise,
speculative scaling concerns, and demands for unrelated cleanup. A review does not authorize
fixes, approval, merge, or deployment.
