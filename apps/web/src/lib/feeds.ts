import { GroupKey, Source } from "./types";
import { sources } from "./data";

// 各ソースのフィードURL候補（上から順に試行）
export const FEED_URLS: Record<string, string[]> = {
  // Development
  // Prefer official blog for Argo projects
  "argo-cd": [
    "https://blog.argoproj.io/feed",
    "https://blog.argoproj.io/rss.xml",
    "https://blog.argoproj.io/atom.xml",
    "https://github.com/argoproj/argo-cd/releases.atom",
  ],
  circleci: ["https://circleci.com/blog/feed/", "https://circleci.com/blog/feed.xml"],
  github: ["https://github.blog/feed/"],
  gitlab: ["https://about.gitlab.com/releases/index.xml", "https://about.gitlab.com/atom.xml"],
  docker: ["https://www.docker.com/blog/feed/"],

  // Cloud / Infrastructure
  aws: ["https://aws.amazon.com/blogs/aws/feed/"],
  azure: ["https://azure.microsoft.com/en-us/blog/feed/"],
  firebase: ["https://firebase.blog/rss/", "https://firebase.blog/feed/"],
  // legacy fallbacks for Blogger-backed feeds
  // Older official blog domain
  firebase_legacy: [
    "https://firebase.googleblog.com/atom.xml",
    "https://firebase.googleblog.com/feeds/posts/default?alt=rss",
  ],
  gcp: [
    // User-provided release notes feed (reliable, includes titles and dates)
    "https://cloud.google.com/feeds/gcp-release-notes.xml",
    // JPサイト（ユーザー提供のページを基点に推測）
    "https://cloud.google.com/blog/ja/rss?hl=ja",
    "https://cloud.google.com/blog/ja/rss",
    // ENの安定トピック
    "https://cloud.google.com/blog/topics/announcements/rss",
    // メインRSS（環境によりHTMLを返すことがあるため後方へ）
    "https://cloud.google.com/blog/rss?hl=en",
    "https://cloud.google.com/blog/rss",
    "https://cloud.google.com/blog/atom.xml?hl=en",
  ],
  kubernetes: ["https://kubernetes.io/feed.xml", "https://kubernetes.io/index.xml"],
  terraform: [
    // ユーザー提供のフィードを最優先
    "https://www.hashicorp.com/blog/feed.xml",
    "https://www.hashicorp.com/ja/blog/feed.xml",
    // タグのRSS
    "https://www.hashicorp.com/blog/tags/terraform/index.xml",
    // ルートのRSS
    "https://www.hashicorp.com/blog/index.xml",
    // 製品別（存在する場合）
    "https://www.hashicorp.com/blog/products/terraform/index.xml",
    // 最終フォールバック: GitHub Releases（ブログではないが更新情報としては有用）
    "https://github.com/hashicorp/terraform/releases.atom",
  ],

  // Libraries / Framework
  nextjs: ["https://nextjs.org/blog/rss.xml", "https://nextjs.org/atom.xml", "https://nextjs.org/feed.xml"],
  nuxt: [
    // primary
    "https://nuxt.com/blog.xml",
    "https://nuxt.com/blog/feed.xml",
    "https://nuxt.com/feed.xml",
    // common alternates
    "https://nuxt.com/blog/index.xml",
    "https://nuxt.com/blog/rss.xml",
    "https://nuxt.com/blog/atom.xml",
  ],
  // legacy Nuxt (nuxtjs.org)
  nuxt_legacy: [
    "https://nuxtjs.org/atom.xml",
    "https://nuxtjs.org/blog/feed.xml",
    "https://nuxtjs.org/feed.xml",
    "https://nuxtjs.org/blog/index.xml",
  ],
  rails: ["https://rubyonrails.org/feed.xml", "https://rubyonrails.org/news.xml"],
  react: ["https://react.dev/atom.xml", "https://react.dev/feed.xml", "https://reactjs.org/feed.xml"],
  vue: [
    "https://blog.vuejs.org/feed.xml",
    "https://blog.vuejs.org/atom.xml",
    "https://blog.vuejs.org/rss.xml",
    // community news feed (fallback)
    "https://news.vuejs.org/feed.xml",
  ],

  // Programming
  go: ["https://go.dev/blog/feed.atom"],
  nodejs: ["https://nodejs.org/en/feed/blog.xml"],
  python: [
    "https://www.python.org/blogs/rss",
    "https://www.python.org/feeds/all.atom.xml",
    // older official blog feed
    "https://blog.python.org/feeds/posts/default?alt=rss",
  ],
  ruby: ["https://www.ruby-lang.org/en/feeds/news.rss"],
  rust: ["https://blog.rust-lang.org/feed.xml"],
  typescript: ["https://devblogs.microsoft.com/typescript/feed/"],
};

export function getFeedSourcesByGroup(group?: GroupKey) {
  return group ? sources.filter((s) => s.group === group) : sources;
}

export function getFeedUrls(slug: string) {
  return FEED_URLS[slug] ?? [];
}
