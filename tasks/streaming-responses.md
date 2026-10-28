# Streaming responses and playback

## Goal

Implement [#17](https://github.com/oneway8x-com/OpenHuli/issues/17) on `17-streaming-responses` from main `cd3f944`.

## Notes

- #11 is owned by another chat; #12 and #15 wait on it. #17 depends on merged #9/#10.
- Keep the device credential/authenticated voice transport. Owner console subscription/UI remains #18; no new unauthenticated broadcast.
- Native Gemini public audio is 24 kHz PCM16LE. Convert with a streaming low-pass FIR and rational interpolation to negotiated 16 kHz, framed and paced at 20 ms.
- Tool-capable turns hold model text/audio until authoritative outcomes. Discard pre-tool claims; suppress speech on any unconfirmed outcome. Tool results expose IDs/status only.
- Distinguish generated/sent audio, client playback receipt, and completed turn. Cancellation clears queues and discards stale frames.

## Verification

- `pnpm typecheck` passed, including runtime, Next app and E2E source types.
- `pnpm test`: 301 Vitest tests and 3 script tests passed. New coverage includes FIR/chunk continuity/alias attenuation, queue limits, stale sink callbacks, negotiated legacy compatibility, authenticated socket streaming, cancellation, speakerless text and public-only provider audio.
- `pnpm test:int`: 83 tests passed against a disposable local PostgreSQL database, including distinct generation/playback persistence and cancellation before receipt. Applied committed migrations only; no schema change or remote migration.
- `pnpm build` passed for shared packages, runtime and Next app after final source changes.
- Prisma validation, architecture and prompt guards passed. Full lint: zero errors, 98 existing warnings; new implementation files lint clean. Formatting and diff checks passed.
- `pnpm --filter @corely/runtime smoke:playback --demo`: 10 synthetic frames; first frame consumed at 43 ms, before generation completion; total 239 ms. This is a private loopback authenticated wire demo with a paced sink, not physical sound or cloud latency evidence.
- Self-review fixed stream allocation collisions, late sink callbacks, final-only client compatibility and cancellation during receipt persistence.

## Remaining work / risks

- No physical speaker or paid Gemini smoke was run. Live smoke instructions are in `docs/guides/RESPONSE_PLAYBACK.md`; the user previously confirmed no key is available.
- The reference sink models playback time without a physical sound device. Physical I2S output is intentionally not claimed; no board/amplifier profile has been validated.
- Production tool-capable replies buffer speech until tool outcomes are confirmed; the synthetic tool-free demo demonstrates playback before generation completion. Provider bursts/slow consumers fail closed at explicit bounds.
- Owner console authentication/rendering/browser sink remains #18. This change routes only on the originating authenticated device connection and provides shared event contracts; it does not expose a broadcast endpoint.
- PR: pending creation.
