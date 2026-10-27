import { expect, type APIRequestContext } from "@playwright/test";
import type { TodoDto } from "@corely/contracts";

export async function createTodo(
  request: APIRequestContext,
  title: string,
): Promise<TodoDto> {
  const response = await request.post("/api/todos", {
    data: { title, priority: "medium", description: "Synthetic E2E task" },
  });
  expect(response.status(), "todo fixture should be created").toBe(201);
  return response.json() as Promise<TodoDto>;
}
