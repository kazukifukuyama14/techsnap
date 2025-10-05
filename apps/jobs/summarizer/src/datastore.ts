import { Datastore, Key } from "@google-cloud/datastore";
import crypto from "crypto";
import {
  ArticleRecord,
  ArticleStatus,
  SummaryRecord,
  SummaryStatus,
} from "./types";

const ARTICLE_KIND = "Article";
const SUMMARY_KIND = "Summary";

function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function articleKey(datastore: Datastore, url: string): Key {
  return datastore.key([ARTICLE_KIND, hashUrl(url)]);
}

function summaryKey(datastore: Datastore, url: string): Key {
  return datastore.key([SUMMARY_KIND, hashUrl(url)]);
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function getArticle(
  datastore: Datastore,
  url: string
): Promise<ArticleRecord | null> {
  const key = articleKey(datastore, url);
  const [entity] = await datastore.get(key);
  if (!entity) return null;
  return fromArticleEntity(entity);
}

export async function getSummary(
  datastore: Datastore,
  url: string
): Promise<SummaryRecord | null> {
  const key = summaryKey(datastore, url);
  const [entity] = await datastore.get(key);
  if (!entity) return null;
  return fromSummaryEntity(entity);
}

export async function upsertArticle(
  datastore: Datastore,
  article: Omit<ArticleRecord, "createdAt" | "updatedAt" | "status"> & {
    status?: ArticleStatus;
  }
): Promise<ArticleRecord> {
  const existing = await getArticle(datastore, article.url);
  const now = nowIso();
  const payload: ArticleRecord = {
    url: article.url,
    title: article.title,
    rawBody: article.rawBody,
    status: article.status || existing?.status || "FETCHED",
    sourceId: article.sourceId,
    publishedAt: article.publishedAt || existing?.publishedAt || now,
    fetchedAt: article.fetchedAt || existing?.fetchedAt || now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    failureReason: existing?.failureReason,
    summaryAttemptCount: existing?.summaryAttemptCount || 0,
  };

  const key = articleKey(datastore, article.url);
  await datastore.save({ key, data: payload });
  return payload;
}

export async function updateArticleStatus(
  datastore: Datastore,
  url: string,
  status: ArticleStatus,
  fields: Partial<ArticleRecord> = {}
): Promise<ArticleRecord | null> {
  const key = articleKey(datastore, url);
  const transaction = datastore.transaction();
  await transaction.run();
  try {
    const [entity] = await transaction.get(key);
    if (!entity) {
      await transaction.rollback();
      return null;
    }
    const record = fromArticleEntity(entity);
    const updated: ArticleRecord = {
      ...record,
      ...fields,
      status,
      updatedAt: nowIso(),
    };
    transaction.save({ key, data: updated });
    await transaction.commit();
    return updated;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function recordArticleFailure(
  datastore: Datastore,
  url: string,
  reason: string
): Promise<ArticleRecord | null> {
  const current = await getArticle(datastore, url);
  const attempts = (current?.summaryAttemptCount || 0) + 1;
  return updateArticleStatus(datastore, url, "FAILED", {
    failureReason: reason,
    summaryAttemptCount: attempts,
  });
}

export async function upsertSummary(
  datastore: Datastore,
  summary: Omit<
    SummaryRecord,
    "createdAt" | "updatedAt" | "status" | "articleKey"
  > & {
    status?: SummaryStatus;
  }
): Promise<SummaryRecord> {
  const existing = await getSummary(datastore, summary.articleUrl);
  const now = nowIso();
  const payload: SummaryRecord = {
    articleUrl: summary.articleUrl,
    articleKey: hashUrl(summary.articleUrl),
    status: summary.status || existing?.status || "QUEUED",
    summaryEn: summary.summaryEn,
    summaryJa: summary.summaryJa,
    tokensUsed: summary.tokensUsed ?? existing?.tokensUsed,
    costUsd: summary.costUsd ?? existing?.costUsd,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastError: summary.lastError ?? existing?.lastError,
  };

  const key = summaryKey(datastore, summary.articleUrl);
  await datastore.save({ key, data: payload });
  return payload;
}

export async function updateSummaryStatus(
  datastore: Datastore,
  url: string,
  status: SummaryStatus,
  fields: Partial<SummaryRecord> = {}
): Promise<SummaryRecord | null> {
  const key = summaryKey(datastore, url);
  const transaction = datastore.transaction();
  await transaction.run();
  try {
    const [entity] = await transaction.get(key);
    if (!entity) {
      await transaction.rollback();
      return null;
    }
    const record = fromSummaryEntity(entity);
    const updated: SummaryRecord = {
      ...record,
      ...fields,
      status,
      updatedAt: nowIso(),
    };
    transaction.save({ key, data: updated });
    await transaction.commit();
    return updated;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function fromArticleEntity(entity: any): ArticleRecord {
  return {
    url: String(entity.url),
    title: String(entity.title || ""),
    rawBody: String(entity.rawBody || ""),
    status: (entity.status || "PENDING_FETCH") as ArticleStatus,
    sourceId: String(entity.sourceId || ""),
    publishedAt: toIso(entity.publishedAt),
    fetchedAt: toIso(entity.fetchedAt),
    createdAt: toIso(entity.createdAt),
    updatedAt: toIso(entity.updatedAt),
    failureReason: entity.failureReason ?? undefined,
    summaryAttemptCount:
      typeof entity.summaryAttemptCount === "number"
        ? entity.summaryAttemptCount
        : undefined,
  };
}

function fromSummaryEntity(entity: any): SummaryRecord {
  return {
    articleUrl: String(entity.articleUrl || ""),
    articleKey: String(entity.articleKey || ""),
    status: (entity.status || "QUEUED") as SummaryStatus,
    summaryEn: String(entity.summaryEn || ""),
    summaryJa: String(entity.summaryJa || ""),
    tokensUsed:
      typeof entity.tokensUsed === "number" ? entity.tokensUsed : undefined,
    costUsd: typeof entity.costUsd === "number" ? entity.costUsd : undefined,
    createdAt: toIso(entity.createdAt),
    updatedAt: toIso(entity.updatedAt),
    lastError: entity.lastError ?? undefined,
  };
}

function toIso(value: any): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
