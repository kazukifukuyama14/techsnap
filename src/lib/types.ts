export type GroupKey = "development" | "cloud" | "libraries" | "programming";

export type Source = {
  slug: string;
  name: string;
  group: GroupKey;
  siteUrl?: string;
  icon?: string | null;
};

export type FeedKind = "blog" | "docs" | "release";

export type FeedItem = {
  id: string;
  title: string;
  url: string; // 外部リンク
  publishedAt: string; // ISO
  sourceSlug: string;
  sourceName: string;
  group: GroupKey;
  kind: FeedKind;
  tags?: string[];
  excerpt?: string;
};
