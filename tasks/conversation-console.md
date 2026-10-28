# Conversation console

## Goal

Implement [#18](https://github.com/oneway8x-com/OpenHuli/issues/18) on `18-conversation-console` from merged main `43ef4f5`.

## Notes

- UI owns `/conversations`; runtime owns provider sessions and registered tools. Browser requests use same-origin authenticated Next routes; owner cookies/tokens never enter browser JavaScript or provider context.
- Reuse shared conversation use cases/runtime and exact-argument approval executor. Persisted activity is read through tenant-scoped repository methods. Refresh restores metadata; default-off transcript retention does not restore text.
- #11 remains owned by another chat. Forecast/note tools can only be exercised when its registry integration lands; do not fabricate a success path.

## Verification

In progress.

## Remaining work / risks

Implementation and verification in progress.
