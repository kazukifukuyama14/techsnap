import { FeedItemCandidate } from "./types";

export interface ArticleContentResult {
  title: string;
  url: string;
  body: string;
  sourceId: string;
  publishedAt: string;
}

export async function buildArticleContent(
  candidate: FeedItemCandidate,
  timeoutMs: number
): Promise<ArticleContentResult | null> {
  const publishedAt = candidate.publishedAt || new Date().toISOString();
  let body = candidate.content?.trim() || "";

  if (!body) {
    body = await fetchArticle(candidate.link, timeoutMs);
  }

  if (!body) {
    console.warn(
      `[summarizer] skip article due to empty body: ${candidate.link}`
    );
    return null;
  }

  return {
    title: candidate.title,
    url: candidate.link,
    body,
    sourceId: new URL(candidate.feedUrl).hostname,
    publishedAt,
  };
}

async function fetchArticle(url: string, timeoutMs: number): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn(
        `[summarizer] failed to fetch article: ${url} (${response.status})`
      );
      return "";
    }
    const text = await response.text();
    return extractBody(text);
  } catch (error) {
    console.warn(`[summarizer] error fetching article: ${url}`, error);
    return "";
  }
}

function extractBody(html: string): string {
  // Naive extraction: strip tags and collapse whitespace.
  const withoutScripts = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const withoutStyles = withoutScripts.replace(
    /<style[^>]*>[\s\S]*?<\/style>/gi,
    ""
  );
  const text = withoutStyles.replace(/<[^>]+>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}
