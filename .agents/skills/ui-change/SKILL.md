---
name: ui-change
description: Implement and visually verify user-visible OpenHuli screens, components, copy, layouts, or interactions using existing UI patterns.
---

# Change the UI

Follow [AGENTS.md](../../../AGENTS.md). Inspect the affected UI module under
`apps/app/src/modules`, its callers, and shared components in `packages/ui` before editing.

1. Identify the requested user outcome and reuse existing components and conventions. Keep
   business decisions behind use cases; avoid an unrelated redesign or new design framework.
2. Implement relevant loading, empty, error, and success states. Preserve keyboard navigation,
   focus behavior, labels, and responsive layout for affected interactions.
3. Test meaningful interactions and inspect the actual rendered result at relevant viewport
   sizes. Source inspection and passing unit tests do not establish visual correctness.
4. Capture a useful screenshot or short recording when practical. Keep credentials and personal
   data out of artifacts; do not commit generated screenshots unless they are intended fixtures.
5. Run the application checks in AGENTS.md and review the final diff. If the app cannot run,
   report the exact visual verification gap instead of claiming the UI was verified.

Return the visible outcome, checks, available evidence, and limitations. A useful artifact is
enough; no separate design approval process or mandatory evidence directory is needed.
