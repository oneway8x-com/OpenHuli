"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeBackoffDelayMs, defaultRetryPolicy } from "@corely/api-client";
import { SonnerToaster, Toaster, TooltipProvider } from "@corely/ui";
import { AuthProvider } from "@/components/auth/auth-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            retryDelay: (attempt) =>
              computeBackoffDelayMs(attempt, defaultRetryPolicy),
          },
        },
      }),
  );

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <Toaster />
          <SonnerToaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}
