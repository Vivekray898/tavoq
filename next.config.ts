import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // Cloudflare may inject a Permissions-Policy header with unsupported
  // directives (attribution-reporting, private-aggregation, etc.) which
  // produces console warnings. Those are cosmetic and come from the Cloudflare
  // dashboard, not this app. To silence them:
  //   1. Go to Cloudflare Dashboard → your domain → Network → Permissions-Policy
  //   2. Remove the unsupported directives, or disable the header override
  //
  // If you need to override here instead, add a headers config:
  //   headers: [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "..." }] }]
};

export default withSerwist(nextConfig);