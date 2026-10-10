import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vinext checks multipart bodies before dispatching API routes. Allow the
  // application's 20 MB attachment total plus Markdown and multipart overhead.
  experimental: {
    serverActions: { bodySizeLimit: "22mb" },
  },
};

export default nextConfig;
