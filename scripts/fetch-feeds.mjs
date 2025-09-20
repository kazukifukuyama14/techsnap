#!/usr/bin/env node

const origin = process.env.FEED_CRON_ORIGIN;
if (!origin) {
  console.error("[fetch-feeds] FEED_CRON_ORIGIN is not set. Aborting.");
  process.exit(1);
}

const refreshParam = process.env.FEED_CRON_REFRESH === "1" ? "&refresh=1" : "";
const groupKeys = ["", "development", "cloud", "libraries", "programming"];
const sourceSlugs = [
  "argo-cd",
  "circleci",
  "github",
  "gitlab",
  "docker",
  "aws",
  "azure",
  "firebase",
  "gcp",
  "kubernetes",
  "terraform",
  "nextjs",
  "nuxt",
  "rails",
  "react",
  "vue",
  "go",
  "nodejs",
  "python",
  "ruby",
  "rust",
  "typescript",
];

(async () => {
  try {
    console.log(`[fetch-feeds] start prefetch at ${new Date().toISOString()}`);
    await prefetchAggregates();
    await prefetchSources();
    console.log(`[fetch-feeds] completed at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("[fetch-feeds] failed", error);
    process.exitCode = 1;
  }
})();

async function prefetchAggregates() {
  for (const group of groupKeys) {
    const search = group ? `?group=${group}` : "";
    const url = `${origin}/api/feeds/aggregate${search}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`[fetch-feeds] aggregate ${group || "all"} -> ${res.status}`);
      }
    } catch (error) {
      console.warn(`[fetch-feeds] aggregate ${group || "all"} error`, error);
    }
  }
}

async function prefetchSources() {
  for (const slug of sourceSlugs) {
    const url = `${origin}/api/feeds?slug=${encodeURIComponent(slug)}&limit=50${refreshParam}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`[fetch-feeds] source ${slug} -> ${res.status}`);
      }
    } catch (error) {
      console.warn(`[fetch-feeds] source ${slug} error`, error);
    }
  }
}
