import { z } from "zod";
import type { JsonObject, ToolContext } from "@corely/modules-tool-execution";
import {
  JsonHttpClient,
  HttpToolError,
  validateDestination,
  type Destination,
} from "./http-client";
export interface SecretStore {
  get(reference: string): Promise<string>;
}
/** Server registration owns URL/method/headers/mapping. Only validated arguments enter the body mapper. */
export function jsonOperation<
  A extends JsonObject,
  O extends JsonObject,
>(definition: {
  destination: Destination;
  method: "GET" | "POST";
  expectedStatus: 200 | 201;
  input: z.ZodType<A, z.ZodTypeDef, unknown>;
  output: z.ZodType<O, z.ZodTypeDef, unknown>;
  body?: (arguments_: A) => JsonObject;
  headers?: (context: ToolContext) => Readonly<Record<string, string>>;
  secretReference?: string;
  secrets?: SecretStore;
  client?: JsonHttpClient;
  timeoutMs?: number;
}) {
  validateDestination(definition.destination);
  const operation = Object.freeze({
    ...definition,
    destination: Object.freeze({ ...definition.destination }),
  });
  const client = operation.client ?? new JsonHttpClient();
  return async (value: unknown, context: ToolContext): Promise<O> => {
    const args = operation.input.parse(value);
    const headers: Record<string, string> = {
      ...operation.headers?.(context),
    };
    if (operation.method === "POST")
      headers["Idempotency-Key"] = context.idempotencyKey;
    if (operation.secretReference) {
      if (!operation.secrets) throw new HttpToolError("unavailable");
      let secret: string;
      try {
        secret = await operation.secrets.get(operation.secretReference);
      } catch {
        throw new HttpToolError("unavailable");
      }
      if (!secret || secret.length > 4096 || /[\r\n]/.test(secret))
        throw new HttpToolError("unavailable");
      headers.Authorization = `Bearer ${secret}`;
    }
    const response = await client.send({
      destination: operation.destination,
      method: operation.method,
      expectedStatus: operation.expectedStatus,
      headers,
      signal: context.signal,
      ...(operation.timeoutMs === undefined
        ? {}
        : { timeoutMs: operation.timeoutMs }),
      ...(operation.body ? { body: operation.body(args) } : {}),
    });
    try {
      return operation.output.parse(response);
    } catch {
      throw new HttpToolError("invalid_response");
    }
  };
}
