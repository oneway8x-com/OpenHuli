# Security and current limits

Console access is restricted to the configured owner. Operator bootstrap creates the Home Tenant
and OWNER membership; there is no public signup or bootstrap endpoint. Existing legacy browser
sessions must sign in again.

- Todo routes, dashboard pages, and upload-token creation require a verified session and live
  active owner membership. A caller-supplied Tenant header cannot grant access. Upload paths must
  stay within the owner Tenant namespace; provider callbacks retain SDK signature verification.
- Access and refresh tokens use HttpOnly, SameSite=Lax cookies, with Secure outside development.
  Browser writes check the configured origin. Refresh tokens rotate, logout revokes the server
  session, and every protected request checks session revocation and membership.
- OTP codes expire after 15 minutes, allow five attempts, and have a 60-second resend cooldown.
  Only explicit development mode logs codes and permits the development signing secret. Production
  startup requires safe auth configuration and working email settings; delivery failures are errors.
- Keep secrets out of browser code, committed fixtures, screenshots, and firmware. Do not use real
  provider keys or paid/live services in routine tests. Development OTP logs are sensitive.
- Database tests require the explicitly named local `openhuli_test` database. Setup never falls
  back to `DATABASE_URL`; cleanup is restricted to test-owned rows.

Email delivery requires operator setup and has not been verified against a live provider in routine
checks. In-memory or edge-wide abuse protection is not implemented; production hosting should bound
request volume. The [MVP specification](../mvp-spec.md) defines pending device transport wiring, broker ACL,
TLS, AI tool approval/idempotency, and privacy requirements. These are not existing guarantees.
[Device pairing](DEVICE_PAIRING.md) adds hashed, purpose-scoped credentials, constrained manifests,
exact topic/target authorization, and a revocation watchdog. Device WSS and broker adapters must
wire those shared guards before enabling device connections; they are separate tickets.
Do not include secrets or personal data when reporting a vulnerability.
