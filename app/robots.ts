import type { MetadataRoute } from "next";

/**
 * Crawl policy for Taskora.
 *
 * Only the public marketing/legal pages and the sign-in screens are
 * crawlable. Every authenticated dashboard route is disallowed, so a
 * private workspace page can never surface in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/login", "/offline"],
      disallow: [
        "/dashboard",
        "/tasks",
        "/projects",
        "/clients",
        "/employees",
        "/payments",
        "/notifications",
        "/settings",
        "/profile",
        "/calendar",
        "/admin",
        "/employee",
        "/signup",
        "/pending",
        "/suspended",
        "/invite",
        "/forgot-password",
        "/reset-password",
        "/auth",
        "/api",
      ],
    },
    sitemap: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://task.creativoxa.com"}/sitemap.xml`,
  };
}
