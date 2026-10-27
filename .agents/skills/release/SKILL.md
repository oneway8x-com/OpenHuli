---
name: release
description: Prepare or perform a requested OpenHuli release, deployment, or rollback using the repository's actual configuration and available hosting setup.
---

# Release a small project

Follow [AGENTS.md](../../../AGENTS.md). Inspect current scripts, deployment configuration, and
setup documentation. Do not import TruckerPoints cloud accounts, promotion stages, or runbooks.

1. Establish the requested action, target, exact source revision or artifact, and current state.
   A preparation request produces a concrete plan; an explicit deployment/release request supplies
   authorization for its stated scope. Do not ask again for permission already given.
2. Check relevant tests/build results, required configuration, migration compatibility, and the
   previous working revision. Identify recovery steps and data backup needs when applicable.
3. Use the existing supported release mechanism. If the target or mechanism is missing, complete
   useful preparation and ask for that specific missing decision rather than inventing infrastructure.
4. Perform only the requested action. Verify database targets before migrations; resets, restores,
   and destructive changes require their own authorization. Application rollback does not undo data.
5. Inspect completion and the deployed user path, including health or connectivity where relevant.
   If an action fails or times out, inspect actual state before retrying or starting another release.

Return the revision, target, release/deployment link when available, observed checks, recovery
information, and remaining limits. A dispatch, tag, or successful build alone does not prove a
working deployment. Local setup files do not establish a working MQTT, voice, or hardware path.
