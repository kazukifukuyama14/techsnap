import Parser from "rss-parser";
import { FeedItemCandidate } from "./types";

type RSSItem = Parser.Item & {
  isoDate?: string;
};

type RSSFeed = Parser.Output<RSSItem>;

const parser: Parser<RSSFeed, RSSItem> = new Parser();

export async function fetchFeedItems(
  feedUrl: string,
  limit: number
): Promise<FeedItemCandidate[]> {
  try {
    const feed = await parser.parseURL(feedUrl);
    return (feed.items || [])
      .slice(0, limit)
      .map((item: RSSItem) => ({
        feedUrl,
        title: item.title || "(untitled)",
        link: item.link || "",
        publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
        content: item.contentSnippet || item.content || "",
      }))
      .filter((item) => item.link);
  } catch (error) {
    console.error(`[summarizer] failed to fetch RSS feed: ${feedUrl}`, error);
    return [];
  }
}
