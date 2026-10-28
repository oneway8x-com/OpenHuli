import { randomUUID } from "node:crypto";
import type { ConversationJournal } from "./conversation-runtime.types";
import type { ConversationRepository } from "./conversation.repository";
import {
  startConversation,
  startConversationTurn,
  transitionConversationTurn,
  appendConversationMessage,
  recordConversationUsage,
} from "./conversation.use-cases";

/** Durable metadata only; transcript retention stays off. */
export function createConversationJournal(
  repository: ConversationRepository,
): ConversationJournal {
  return {
    async start(context) {
      await startConversation(
        {
          id: context.conversationId,
          deviceId: context.deviceId,
          correlationId: context.sessionId,
          retainTranscripts: false,
          expiresAt: new Date(Date.now() + 3600000),
        },
        context,
        repository,
      );
    },
    async turn(context) {
      await startConversationTurn(
        {
          version: 1,
          conversationId: context.conversationId,
          turnId: context.turnId,
          turnSequence: context.turnSequence,
          source: context.source ?? "voice",
          status: "collecting",
          correlationId: context.turnId,
        },
        context,
        repository,
      );
    },
    async transition(context, status) {
      await transitionConversationTurn(
        {
          conversationId: context.conversationId,
          turnId: context.turnId,
          status,
        },
        context,
        repository,
      );
    },
    async message(context, role, text) {
      await appendConversationMessage(
        {
          id: randomUUID(),
          conversationId: context.conversationId,
          turnId: context.turnId,
          role,
          ...(text ? { text } : {}),
        },
        context,
        repository,
      );
    },
    async usage(context, metric, quantity) {
      await recordConversationUsage(
        {
          conversationId: context.conversationId,
          turnId: context.turnId,
          eventId: randomUUID(),
          metric,
          quantity,
        },
        context,
        repository,
      );
    },
  };
}
