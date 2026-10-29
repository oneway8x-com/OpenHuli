# Dashboard Backoffice theme

## Goal

Apply the requested Backoffice theme and layout patterns to the OpenHuli dashboard and show the rendered result.

## Notes

- Issue-less request; branch `codex/dashboard-backoffice-theme` starts from the verified `origin/main`.
- Reuse the reference's semantic palette, compact corner scale, navy navigation, white header, and neutral page surfaces. Keep OpenHuli branding and existing feature flows.
- Use the existing shared UI components and a responsive navigation drawer; preserve server authentication and API boundaries.
- The mobile trigger stays disabled until hydration attaches drawer handlers, preventing a lost click immediately after sign-in.
- Screenshots use synthetic browser responses in a temporary frontend copy. No preview authentication bypass belongs in application source.

## Verification

- Follow-up: ignored root Playwright MCP snapshots and `output/playwright/` screenshots and preview artifacts; verified all current generated artifacts are ignored.
- `pnpm typecheck`: passed.
- `pnpm test`: passed (22 script tests and 380 unit tests across 39 files).
- `pnpm --filter @corely/data exec prisma validate`: passed.
- `pnpm arch:check`: passed.
- `pnpm build`: passed.
- Targeted ESLint, Prettier, and `git diff --check`: passed.
- Rendered Devices, Conversations, and Todos with synthetic data; captured desktop and mobile screenshots outside version control. Verified no document overflow at 390px and 320px and manually exercised task-load failure and Retry recovery.
- Full Playwright suite: 16/18 passed. Both new navigation tests passed. The owner sign-out journey exposed a pre-hydration menu click, now addressed with a readiness guard; the targeted navigation/auth rerun passed all 4 tests, including OTP sign-in and mobile sign-out. The existing Uno/Nano pairing test fails at `getByText("Synthetic Nano USB", { exact: true })` because the device name appears in both the list and heading. The same locator and duplicated markup are present on `origin/main`; no assertion was weakened.
- Typecheck, unit tests, Prisma validation, architecture checks, targeted lint, and production build passed again after the hydration guard. `playwright test dashboard-navigation.spec.ts owner-auth.spec.ts`: 4/4 passed.

## Remaining work / risks

Complete self-review found no further issue in the theme, responsive navigation, authentication boundary, or affected feature flows. Published [PR #52](https://github.com/oneway8x-com/OpenHuli/pull/52). The unrelated Uno/Nano test locator remains to be corrected separately. Screenshots establish frontend appearance with synthetic data; live hardware and providers are outside this styling change.
