import type { MetadataRoute } from "next";

const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://task.creativoxa.com").replace(
  /\/+$/,
  ""
);

/**
 * Only the three public pages are listed.
 *
 * Authenticated dashboard routes are deliberately omitted so they are
 * never advertised to search engines (app/robots.ts disallows them).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/terms`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
