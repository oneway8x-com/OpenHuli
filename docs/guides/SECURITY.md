# Security and current limits

This is a development scaffold, not a publicly deployable authenticated device service.

- Todo handlers currently accept `x-tenant-id` or a development fallback. A header is not
  authentication and the current UI does not enforce owner access. Issue #3 replaces this with
  server-verified sessions and membership, production secret validation, and isolation tests.
- OTP/JWT helpers exist, but their presence does not protect every route or complete onboarding.
  The development JWT fallback and production email behavior also need the #3 hardening work.
- Bind the local app and database to loopback. Do not publish the scaffold, broker, or database
  publicly based on a green build, a login screen, or the mocked auth-handler tests.
- Keep secrets out of browser code, logs, committed fixtures, screenshots, and firmware. Do not
  use real provider keys or paid/live services in routine tests.
- Validate input with shared schemas and keep mutations behind explicit use cases. Test Tenant
  isolation in persistence, but do not mistake repository scoping for authenticated route authority.
- Database tests require the explicitly named local `openhuli_test` database. Their setup never
  falls back to `DATABASE_URL`; cleanup is restricted to test-owned rows.

The [MVP specification](../mvp-spec.md) defines the pending device credential, MQTT ACL, TLS,
AI tool approval/idempotency, and privacy requirements. These are release gates, not existing guarantees.
Do not include secrets or personal data when reporting a vulnerability; share only the minimum
reproduction and affected source locations with the maintainer.
