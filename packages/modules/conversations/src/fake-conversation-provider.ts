import type {
  ConversationProviderFactory,
  ProviderEvent,
} from "./conversation-runtime.types";

/** Deterministic scripted adapter for tests/simulator only. Never composed by production startup. */
export function createFakeConversationProvider(
  turns: readonly (readonly ProviderEvent[])[],
) {
  const trace: { kind: string; value?: unknown }[] = [];
  let opened = 0;
  const factory: ConversationProviderFactory = {
    async open(input) {
      opened++;
      trace.push({ kind: "open", value: input });
      let index = 0,
        events: ProviderEvent[] = [],
        closed = false;
      let blocked: ((error: Error) => void) | undefined;
      return {
        async begin(source) {
          if (closed) throw new Error("closed");
          trace.push({ kind: "begin", value: source });
        },
        async audio(bytes) {
          trace.push({ kind: "audio", value: bytes.byteLength });
        },
        async commit(text) {
          if (closed) throw new Error("closed");
          trace.push({ kind: "commit", value: text });
          events = [...(turns[index++] ?? [])];
        },
        async next() {
          if (closed) throw new Error("closed");
          const event = events.shift();
          if (event) return event;
          return new Promise<ProviderEvent>((_resolve, reject) => {
            blocked = reject;
          });
        },
        async result(id, name, result) {
          trace.push({ kind: "result", value: { id, name, result } });
        },
        async close() {
          if (closed) return;
          closed = true;
          trace.push({ kind: "close" });
          blocked?.(new Error("closed"));
        },
      };
    },
  };
  return {
    factory,
    trace,
    get opened() {
      return opened;
    },
  };
}
