# Owner authentication and server-derived Tenant scope

## Goal

Implement [#3](https://github.com/oneway8x-com/OpenHuli/issues/3) on `03-owner-auth`, based on merged
foundation PR #23. Issue #3 is In progress in Project 3.

## Notes

- Keep the single-owner OTP experience, add explicit operator bootstrap, and derive authority from
  live sessions and stored active OWNER membership. Remove header/fallback authorization.
- Keep identity use cases reusable and Prisma behind its repository. Use HttpOnly cookies, strict
  token claims, rotating refresh sessions, same-origin browser writes, and owner-only account access.
- Production runtime must reject missing/unsafe auth configuration; no public signup/bootstrap API.
- Use only synthetic accounts and disposable local PostgreSQL for validation. No live mail/provider calls.

## Verification

- Passed type checking; 91 unit tests plus 3 script tests; 14 PostgreSQL integration tests.
- Passed lint (98 existing warnings, zero errors), architecture/prompt checks, Prisma validation,
  and production build. No schema migration was needed.
- Chromium: initial five-test suite passed; final rerun includes explicit stale-token replay after logout.
  Inspected desktop login and mobile owner navigation screenshots.
- Production startup rejects missing/development JWT secrets; a synthetic valid configuration serves
  the login page. No live delivery calls. Operator bootstrap ran twice against a disposable local
  database and returned the same owner Tenant.
- Implementation is isolated in a managed worktree because issue #4 was implemented concurrently
  in the original checkout. No unrelated checkout changes were modified.

## Remaining work / risks

- Finish final browser rerun and PR handoff.
- Live email delivery and hosted deployment remain unverified; configure the owner, origin, signing
  secret, sender, and delivery key before production startup. Existing legacy sessions require login.
- Device credentials, MQTT, and AI execution are separate tickets. Hosting-wide abuse controls remain
  an operator concern; OTP verification is limited per code and resend is limited per owner.
