---
name: bug-fix
description: Reproduce, diagnose, and fix an OpenHuli defect with targeted regression coverage. Diagnosis-only requests remain read-only.
---

# Fix a defect

Follow [AGENTS.md](../../../AGENTS.md). For an authorized fix, create or reuse the task diary
using [the template](../../../tasks/TEMPLATE.md). Establish expected behavior from the request,
existing contracts, and callers before changing product semantics.

1. Reproduce with the smallest safe test or fixture. Record the failure and any environment limits;
   do not use real user data or mutate shared services just to reproduce a bug.
2. Trace the failure through the complete request flow to its cause. Check whether it is newly
   introduced or pre-existing. For diagnosis-only requests, return the evidence here without edits.
3. Add or update a regression test that exposes the failing behavior, then make the smallest fix.
   Preserve use-case, persistence, authorization, and tenant boundaries.
4. Test the relevant failure and success paths. Include retries, concurrency, or partial failure
   only when they contribute to this defect. Run the required application checks in AGENTS.md.
5. Inspect the diff for symptom masking, weakened checks, and unrelated changes.

Record the cause and check results in the diary for implementation work. Report the corrected
behavior, regression evidence, and remaining verification limits.
Do not claim a reproduction or passing test that was not actually observed.
