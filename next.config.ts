import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Image artifact uploads (paste, file picker) need to fit in here.
      // Action-level cap is 10MB in src/app/boards/[id]/actions.ts.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
