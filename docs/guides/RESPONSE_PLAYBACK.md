# Streaming responses and playback

Issue [#17](https://github.com/oneway8x-com/OpenHuli/issues/17) adds response routing on the existing
credential-authenticated `/voice` connection. Nothing broadcasts across devices or Tenants. The
owner console's authenticated subscription and rendering are implemented by #18; these shared
events are its transport vocabulary, not a new public event endpoint.

## Negotiation and response events

Offer `streamingResponses: true` in `session.start`; `session.ready` echoes acceptance. This opts
into `response.delta` (incremental public text) and `tool.result` (server execution ID/status only).
Sessions that omit it retain final `response.text` behavior. Deltas are transient previews; replace
with the final text. They never contain thought parts, private provider errors, tool arguments,
credentials, or full internal executor output. No input transcript is emitted by this adapter.

Separately offer `outputFormat: {encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1,
chunkDurationMs: 20}` on a paired profile with the speaker capability. The server echoes the format
only when supported. Speakerless clients omit it and receive usable final text/status without a
playback wait. `turn.text` and committed microphone turns use the same response path.

Tool-free providers can stream text/audio as generated. Tool-capable turns hold model text/audio
until generation completes and every actual tool result is `succeeded`. Pre-tool language/audio is
discarded. Any failed, denied, pending approval, expired, cancelled or unknown result suppresses
model speech and produces authoritative final status text instead. A model sentence is never
execution evidence. This deliberately trades tool-turn speech latency for truthful outcomes; the
production registry currently always has tools, so its speech is delivered after this check.

## Audio lifecycle and limits

Google documents [native audio output as 24 kHz PCM16LE](https://ai.google.dev/gemini-api/docs/live-api/capabilities).
The adapter accepts only public `audio/pcm;rate=24000`, strict base64 and whole 16-bit samples.
A stateful 31-tap Hamming-windowed low-pass FIR (7 kHz cutoff) and rational 3:2 interpolation convert
to 16 kHz. Phase/filter history survive provider chunk boundaries; group delay is about 0.63 ms.
The final frame is zero padded by less than 20 ms. This is software conversion, not a fidelity or
physical speaker measurement.

The server sends `audio.start`, ordered 640-byte PCM frames with the shared 24-byte header, and
`audio.generation.completed` with the exact last sequence after the final frame has been sent.
Frames are paced at 20 ms; limits close the turn rather than drop/reorder audio. At most 30 seconds
(1,500 frames) can be generated, held or sent; the existing model/whole-turn deadlines still apply,
including delivery time. Gemini queues at most 64 events. A provider burst or slow output can fail
closed; there is no unbounded queue or automatic retry.

Generation completion means no further audio will be sent. It is distinct from the client receiving
frames and from actual playback. The client sends `playback.completed` only after generation is
complete **and its sink has finished every frame**. The wire peer validates turn, stream and final
sequence; the authenticated use case records playback separately from generation in existing
turn metadata. The server sends `turn.completed` only after that receipt. A receipt is a device
claim, not independent proof of a physical speaker effect. Missing receipts time out; they are
never silently treated as playback success.

On stop, send `turn.cancel` and stop/flush the local sink immediately. Discard queued and old-turn
frames. The server aborts generation/delivery and rejects late output. Cancellation also closes
this provider connection; reconnect with a fresh authenticated session, never replay a turn. Queued
external writes can have unknown outcomes; stopping audio is not an undo. Disconnect/revocation
use the same cleanup path. No raw audio or transcript persistence is added.

## Reference simulator

`OpenHuliPlayback` is a bounded queue with explicit frame consumption/completion and cancellation.
The runtime simulator uses the shared wire peer, a two-second queue (100 frames), and a cancellable
sink that consumes one frame per 20 ms. Its receipt follows sink completion, never enqueue.

```sh
# No provider calls or credentials: synthetic tone through an authenticated loopback gateway.
pnpm --filter @corely/runtime smoke:playback --demo
# Opt-in provider cost. Use a locally configured paired voice credential with speaker capability.
# OPENHULI_RUNTIME_URL must use verified WSS outside loopback; TLS verification remains enabled.
pnpm --filter @corely/runtime smoke:playback --live
```

The live command reads `OPENHULI_RUNTIME_URL` and `OPENHULI_DEVICE_TOKEN` from the local environment.
Keep the runtime's `GEMINI_API_KEY` on the server. The sink models real-time consumption and does not
operate a physical sound device. Output contains timing/frame counts only. Ctrl-C cancels and
flushes it. There is no reconnect/replay. The demo checks that its first consumed frame precedes
generation completion; timing is local synthetic evidence, not a cloud latency claim.

No physical I2S board/amplifier profile, playback driver, acoustic test or live Gemini measurement
is claimed. Physical output requires a separately verified profile/hardware log. The [owner console](CONVERSATION_CONSOLE.md) is text-only; physical/browser audio sinks require
separate validation. Firmware remains #15/#16.
