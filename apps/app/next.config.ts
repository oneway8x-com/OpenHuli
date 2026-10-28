import path from "node:path";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { readAuthConfig } from "@corely/modules-identity/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@corely/api-client",
    "@corely/contracts",
    "@corely/modules-todos",
    "@corely/modules-identity",
    "@corely/modules-devices",
    "@corely/ui",
  ],
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
};

export default function config(phase: string): NextConfig {
  // Compilation needs no live credentials; every supported server startup validates them.
  if (phase !== PHASE_PRODUCTION_BUILD) readAuthConfig();
  return nextConfig;
}
