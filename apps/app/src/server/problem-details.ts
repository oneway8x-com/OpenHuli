import { DeviceAccessError } from "@corely/modules-devices";
import { ZodError } from "zod";
import { TodoNotFoundError } from "@corely/modules-todos";
import { IdentityError } from "@corely/modules-identity";

export function problemFromError(error: unknown): Response {
  if (error instanceof IdentityError || error instanceof DeviceAccessError)
    return Response.json(
      { type: "about:blank", title: error.message, status: error.status },
      { status: error.status },
    );
  if (error instanceof TodoNotFoundError)
    return Response.json(
      { type: "about:blank", title: "Not Found", status: 404 },
      { status: 404 },
    );
  if (error instanceof ZodError)
    return Response.json(
      {
        type: "about:blank",
        title: "Validation failed",
        status: 400,
        errors: error.flatten(),
      },
      { status: 400 },
    );
  return Response.json(
    { type: "about:blank", title: "Internal Server Error", status: 500 },
    { status: 500 },
  );
}
