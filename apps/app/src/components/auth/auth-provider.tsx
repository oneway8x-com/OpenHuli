"use client";
import { useEffect, useState, type ReactNode } from "react";
import { OwnerSessionSchema, type OwnerSession } from "@corely/contracts";
import { AuthContext } from "./auth-context";

async function authRequest(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const problem = (await response
      .json()
      .catch(() => ({ title: "Sign in failed" }))) as { title?: string };
    throw new Error(problem.title || "Sign in failed");
  }
  return response.status === 204 ? null : response.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OwnerSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let result: unknown;
        try {
          result = await authRequest("me");
        } catch {
          result = await authRequest("refresh", {});
        }
        if (active) setUser(OwnerSessionSchema.parse(result));
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function perform<T>(work: () => Promise<T>): Promise<T> {
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
      throw cause;
    }
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        error,
        requestEmailCode: (data) =>
          perform(
            async () =>
              (await authRequest("request-code", data)) as {
                message: string;
                canProceed: boolean;
                cooldownSeconds: number;
              },
          ),
        verifyEmailCode: (data) =>
          perform(async () => {
            const result = OwnerSessionSchema.parse(
              await authRequest("verify-code", data),
            );
            setUser(result);
            return result;
          }),
        logout: async () => {
          await perform(() => authRequest("logout", {}));
          setUser(null);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
