export type ArticleStatus =
  | "PENDING_FETCH"
  | "FETCHED"
  | "IN_PROGRESS"
  | "SUMMARIZED"
  | "FAILED";
export type SummaryStatus = "QUEUED" | "IN_PROGRESS" | "SUMMARIZED" | "FAILED";

export interface ArticleRecord {
  url: string;
  title: string;
  rawBody: string;
  status: ArticleStatus;
  sourceId: string;
  publishedAt: string;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
  failureReason?: string | null;
  summaryAttemptCount?: number;
}

export interface SummaryRecord {
  articleUrl: string;
  articleKey: string;
  status: SummaryStatus;
  summaryEn: string;
  summaryJa: string;
  tokensUsed?: number;
  costUsd?: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
}

export interface FeedItemCandidate {
  feedUrl: string;
  title: string;
  link: string;
  publishedAt?: string;
  content?: string;
}

export interface SummarizationResult {
  summaryEn: string;
  summaryJa: string;
  tokensUsed?: number;
  costUsd?: number;
  durationMs: number;
}
