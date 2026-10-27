# Device pairing and scoped credentials

## Goal

Implement [#7](https://github.com/oneway8x-com/OpenHuli/issues/7) on `07-device-pairing` from merged persistence PR #27 (`152662c`). Ticket is In progress in Project 3.

## Notes

- #5 is active in another chat. #6 was handed off and merged by its own chat; this branch uses the merged result. Its original checkout was not modified.
- Extended the existing devices feature with profile/credential policy and scoped repository methods.
- Owner-only pairing issues separate voice/MQTT secrets once; persistence stores only hashes.
- Capability advertisements cannot expand owner configuration or grants. Server credentials bind
  Tenant, device, purpose, and expiry. Explicit topic authorization and live revocation policy.
- Full onboarding UI belongs to #19; this ticket supplies owner APIs and documented provisioning.

## Verification

- Type checking passed, including the app consuming the devices feature. Repository create inputs
  now use explicit fields so the app's legacy non-strict TypeScript settings do not infer optional
  Prisma create properties from spread Zod inputs.
- 171 unit tests plus 3 script tests passed; all 18 device-access cases also passed after final
  assertions for legacy purpose, missing grant targets, and fail-closed idle watchdog timeouts.
- 37 PostgreSQL integration tests passed, including nine new real owner/device HTTP journeys,
  concurrent rotation, purpose isolation, capability escalation denial, and cross-tenant access and disabled-Tenant denial.
- Fresh and seeded migration checks passed and preserve legacy records without granting scopes.
  Prisma generation/validation, architecture/prompt checks, and frozen offline installation passed.
- Five existing Chromium owner/todo journeys passed. No UI changes or live device/provider calls.
- Focused lint on new code passed without warnings; full lint has 98 existing warnings and no errors.
  Production build passed again after the final active-Tenant authentication guard.
- Initial integration run exposed shared fixed-owner test fixtures; the new suite now owns a unique
  owner and Tenant, and the full parallel suite passes without serializing or weakening checks.

## Remaining work / risks

- Implementation, self-review, and required local checks complete. PR handoff below.
- WSS/broker transports must wire the exported authentication, topic authorization, per-operation
  revalidation, and idle watchdog before enabling device connections (#9/#13). No live broker,
  hardware firmware provisioning, or hosted TLS was exercised; full onboarding UI remains #19.
- Existing unscoped credentials remain legacy and cannot authenticate through the scoped flow.
  The migration is additive; no remote databases were modified.
