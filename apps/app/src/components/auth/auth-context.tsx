"use client";
import { createContext, useContext } from "react";
import type { OwnerSession } from "@corely/contracts";

export interface AuthContextType {
  user: OwnerSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestEmailCode: (data: {
    email: string;
  }) => Promise<{
    message: string;
    canProceed: boolean;
    cooldownSeconds: number;
  }>;
  verifyEmailCode: (data: {
    email: string;
    code: string;
  }) => Promise<OwnerSession>;
  logout: () => Promise<void>;
  error: string | null;
}
export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth requires AuthProvider");
  return context;
}
