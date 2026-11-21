import type { NextConfig } from "next";

/**
 * Without NEXT_PUBLIC_API_URL (local development) the browser reaches the API through this site's own /api path,
 * so the site works from any address this machine is reached by, a tunnel too (`pnpm tunnel`), with no CORS setup.
 * The deployment sets NEXT_PUBLIC_API_URL and calls the API directly.
 */
const apiProxyTarget = process.env.NEXT_PUBLIC_API_URL ? null : (process.env.API_PROXY_URL ?? "http://127.0.0.1:8787");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // `pnpm tunnel` serves the dev server at a *.trycloudflare.com address; Next blocks its dev resources otherwise.
  allowedDevOrigins: ["*.trycloudflare.com"],
  async rewrites() {
    return apiProxyTarget ? [{ source: "/api/:path*", destination: `${apiProxyTarget}/:path*` }] : [];
  },
  // The data pattern package is shipped as TypeScript source and compiled here.
  transpilePackages: ["@aed/schema"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
