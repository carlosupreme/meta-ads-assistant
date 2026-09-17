import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // The repo root has its own lockfile; this app is deployed from this folder on its own.
  outputFileTracingRoot: __dirname,
  // Lint runs in the main app; the backoffice has no ESLint setup of its own.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
