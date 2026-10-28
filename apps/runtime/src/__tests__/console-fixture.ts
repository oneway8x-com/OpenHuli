/** Synthetic provider/effect fixture shared by integration and browser test hosts. Never imported by production startup. */
import { z } from "zod";
import { OpenHuliIdSchema, OpenHuliJsonObjectSchema } from "@corely/contracts";
import { defineTool, ToolRegistry } from "@corely/modules-tool-execution";
import { createFakeConversationProvider } from "@corely/modules-conversations/testing";
import type {
  ConversationProviderFactory,
  ConversationProvider,
} from "@corely/modules-conversations";
import { createLiveConversationRuntime } from "../conversation-composition";
import type { RuntimeConfig } from "../config";
export function createConsoleFixture(config: RuntimeConfig) {
  let effects = 0;
  const provider: ConversationProviderFactory = {
    async open(input) {
      let handle: ConversationProvider | undefined;
      return {
        async begin() {},
        async audio() {},
        async commit(text) {
          const fake = createFakeConversationProvider([
            [
              {
                type: "tool",
                id: `call-${crypto.randomUUID()}`,
                name: "device_context",
                arguments: {
                  deviceId: input.context.deviceId,
                  mode: text?.includes("unknown")
                    ? "unknown"
                    : text?.includes("partial")
                      ? "partial"
                      : "success",
                },
              },
              {
                type: "text",
                text: "Everything succeeded! <script>alert('unsafe')</script>",
              },
              { type: "complete" },
            ],
          ]);
          handle = await fake.factory.open(input);
          await handle.begin("text");
          await handle.commit(text);
        },
        async next() {
          if (!handle) throw new Error("Missing turn");
          return handle.next();
        },
        async result(id, name, result) {
          await handle?.result(id, name, result);
        },
        async close() {
          await handle?.close();
        },
      };
    },
  };
  const composition = createLiveConversationRuntime(config, provider);
  composition.tools.registry = new ToolRegistry([
    defineTool({
      id: "device_context",
      revision: "console-fixture",
      effect: "write",
      resource: "device",
      risk: "low",
      approval: "required",
      timeoutMs: 2000,
      maxAttempts: 1,
      input: z
        .object({
          deviceId: OpenHuliIdSchema,
          mode: z.enum(["success", "unknown", "partial"]),
        })
        .strict(),
      output: OpenHuliJsonObjectSchema,
      target: (args) => args.deviceId,
      async execute(args) {
        effects++;
        if (args.mode === "unknown")
          throw new Error("Synthetic transport lost after effect");
        return {
          kind: args.mode === "partial" ? "partial" : "succeeded",
          output: {
            source: "synthetic fixture",
            observedAt: "2026-10-28T10:00:00.000Z",
            effects,
            privateToken: "must-not-appear-in-console",
          },
        };
      },
    }),
  ]);
  return { composition, effects: () => effects };
}
