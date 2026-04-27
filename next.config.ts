import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext (Cloudflare adapter) consumes `.next/standalone` — only emitted
  // when this is set. Production builds only; doesn't affect `next dev`.
  output: "standalone",
  experimental: {
    serverActions: {
      // Image artifact uploads (paste, file picker) need to fit in here.
      // Action-level cap is 10MB in src/app/boards/[id]/actions.ts.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
