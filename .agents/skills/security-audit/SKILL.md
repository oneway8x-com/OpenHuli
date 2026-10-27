---
name: security-audit
description: Review OpenHuli security boundaries or investigate a suspected vulnerability using source evidence and bounded local checks. Use for security questions or explicitly requested audits.
---

# Review security boundaries

Follow [AGENTS.md](../../../AGENTS.md). Keep a focused question focused. For a broad audit,
state the inspected scope and gaps; no multi-agent pipeline or generated report suite is required.

1. Trace reachable entrypoints, untrusted inputs, authenticated identities, protected resources,
   and the controls between them. Inspect actual runtime wiring rather than planned capabilities.
2. Select applicable boundaries: session/tenant access; secret handling; registered HTTP tool
   destinations and SSRF; AI tool grants, approvals, and idempotency; device credentials and
   MQTT/WSS access; payload bounds, retention, and logs. Do not invent findings for absent features.
3. For a suspected vulnerability, identify the lower-trust actor, reachable input, crossed
   boundary, affected resource, and concrete consequence. Validate with minimal local synthetic
   fixtures when safe; otherwise state the exact missing evidence.
4. Keep tests bounded and local. Do not probe live deployments, access other users' data, spend
   provider quota, or perform destructive/load tests without authorization for that activity.
5. Report confirmed issues with location, prerequisites, demonstrated impact, and a focused fix.
   Separate unverified hypotheses from confirmed vulnerabilities; do not present a missing best
   practice or unknown deployment setting as a proven exploit.

Return prioritized findings and verification limits. Create report files only when requested.
A review does not authorize code fixes, publishing vulnerabilities, or infrastructure changes.
