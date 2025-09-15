import { FeedItem, GroupKey, Source } from "./types";
export const sources: Source[] = [
  // Development
  { slug: "argo-cd", name: "Argo CD", group: "development", siteUrl: "https://blog.argoproj.io/" },
  { slug: "circleci", name: "CircleCI", group: "development", siteUrl: "https://circleci.com/" },
  { slug: "github", name: "GitHub", group: "development", siteUrl: "https://github.blog/" },
  { slug: "gitlab", name: "GitLab", group: "development", siteUrl: "https://about.gitlab.com/releases/" },
  { slug: "docker", name: "Docker", group: "development", siteUrl: "https://www.docker.com/blog/" },

  // Cloud / Infrastructure
  { slug: "aws", name: "AWS", group: "cloud", siteUrl: "https://aws.amazon.com/blogs/" },
  { slug: "azure", name: "Azure", group: "cloud", siteUrl: "https://azure.microsoft.com/" },
  { slug: "firebase", name: "Firebase", group: "cloud", siteUrl: "https://firebase.blog/" },
  { slug: "gcp", name: "Google Cloud", group: "cloud", siteUrl: "https://cloud.google.com/blog/?hl=en" },
  { slug: "kubernetes", name: "Kubernetes", group: "cloud", siteUrl: "https://kubernetes.io/blog/" },
  { slug: "terraform", name: "Terraform", group: "cloud", siteUrl: "https://www.hashicorp.com/ja/blog" },

  // Libraries / Framework
  { slug: "nextjs", name: "Next.js", group: "libraries", siteUrl: "https://nextjs.org/blog" },
  { slug: "nuxt", name: "Nuxt", group: "libraries", siteUrl: "https://nuxt.com/blog" },
  { slug: "rails", name: "Rails", group: "libraries", siteUrl: "https://rubyonrails.org/news" },
  { slug: "react", name: "React", group: "libraries", siteUrl: "https://react.dev/blog" },
  { slug: "vue", name: "Vue.js", group: "libraries", siteUrl: "https://blog.vuejs.org/" },

  // Programming
  { slug: "go", name: "Go", group: "programming", siteUrl: "https://go.dev/blog" },
  { slug: "nodejs", name: "Node.js", group: "programming", siteUrl: "https://nodejs.org/en/blog" },
  { slug: "python", name: "Python", group: "programming", siteUrl: "https://www.python.org/blogs/" },
  { slug: "ruby", name: "Ruby", group: "programming", siteUrl: "https://www.ruby-lang.org/en/news/" },
  { slug: "rust", name: "Rust", group: "programming", siteUrl: "https://blog.rust-lang.org/" },
  { slug: "typescript", name: "TypeScript", group: "programming", siteUrl: "https://devblogs.microsoft.com/typescript/" },
];

export const feedItems: FeedItem[] = [
  {
    id: "f1",
    title: "Announcing TypeScript 5.6",
    url: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-6/",
    publishedAt: new Date().toISOString(),
    sourceSlug: "typescript",
    sourceName: "TypeScript",
    group: "programming",
    kind: "blog",
    tags: ["release"],
    excerpt: "新機能と改善点のハイライト。",
  },
  {
    id: "f2",
    title: "React Docs: Suspense for Data Fetching",
    url: "https://react.dev/learn/suspense",
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
    sourceSlug: "react",
    sourceName: "React",
    group: "libraries",
    kind: "docs",
    tags: ["suspense"],
    excerpt: "データ取得のためのサスペンス活用。",
  },
  {
    id: "f3",
    title: "Next.js 15.0",
    url: "https://nextjs.org/blog/next-15",
    publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    sourceSlug: "nextjs",
    sourceName: "Next.js",
    group: "libraries",
    kind: "blog",
    tags: ["release"],
  },
  {
    id: "f4",
    title: "Python Docs: Pattern Matching",
    url: "https://docs.python.org/3/reference/compound_stmts.html#match",
    publishedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    sourceSlug: "python",
    sourceName: "Python",
    group: "programming",
    kind: "docs",
    tags: ["language"],
  },
  {
    id: "f5",
    title: "Tailwind CSS v3.4",
    url: "https://tailwindcss.com/blog/tailwindcss-v3-4",
    publishedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
    sourceSlug: "tailwindcss",
    sourceName: "Tailwind CSS",
    group: "libraries",
    kind: "blog",
    tags: ["release"],
  },
  {
    id: "f6",
    title: "Kubernetes 1.xx リリース候補",
    url: "https://kubernetes.io/blog/",
    publishedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    sourceSlug: "kubernetes",
    sourceName: "Kubernetes",
    group: "cloud",
    kind: "blog",
  },
  {
    id: "f7",
    title: "GitHub Copilot のアップデート",
    url: "https://github.blog/",
    publishedAt: new Date(Date.now() - 7 * 3600_000).toISOString(),
    sourceSlug: "github",
    sourceName: "GitHub",
    group: "development",
    kind: "blog",
  },
];

export function listFeedItems(opts?: { group?: GroupKey; sourceSlug?: string; limit?: number }) {
  let list = feedItems
    .slice()
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  if (opts?.group) list = list.filter((i) => i.group === opts.group);
  if (opts?.sourceSlug) list = list.filter((i) => i.sourceSlug === opts.sourceSlug);
  if (opts?.limit) list = list.slice(0, opts.limit);
  return list;
}

export function listSources(group?: GroupKey): Source[] {
  return group ? sources.filter((s) => s.group === group) : sources;
}

export function getSource(slug: string): Source | undefined {
  return sources.find((s) => s.slug === slug);
}

export const GROUP_LABELS: Record<GroupKey, string> = {
  development: "Development",
  cloud: "Cloud / Infrastructure",
  libraries: "Libraries / Framework",
  programming: "Programming",
};
