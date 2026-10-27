---
name: split-ticket
description: Break an oversized OpenHuli issue or request into useful, testable tasks with clear dependencies. Use for task decomposition, not implementation.
---

# Split work only when it helps

Follow [AGENTS.md](../../../AGENTS.md). Read the requested outcome, existing children,
dependencies, and enough implementation to choose realistic boundaries.

1. Identify what is complete, what remains, and any unresolved product or hardware decisions.
2. Prefer small vertical outcomes that can be tested and merged safely. Keep tests with the
   behavior they verify. Keep work together when splitting creates broken intermediate states
   or more coordination than value for one maintainer.
3. Give each proposed task a title, scope, observable acceptance criteria, verification steps,
   dependencies, and material uncertainty. Add approximate effort only when useful and grounded.
4. Account for every parent requirement. Check merge order, contract/migration compatibility,
   and final integration; avoid duplicate issues, circular dependencies, and administrative tasks.
5. If issue creation or updates are requested, inspect current GitHub state, use actual returned
   issue numbers, and verify parent/dependency links and project membership. Use the supplied
   project; this repository's MVP backlog is [OpenHuli Project 3](https://github.com/orgs/oneway8x-com/projects/3).
   Inspect state before retrying an uncertain write to avoid duplicates.

Return either a concrete proposal or verified issue links, and state which. A planning request
does not authorize implementation, issue closure, or silently dropping parent requirements.
