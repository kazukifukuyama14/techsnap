import { Datastore, Key, Query } from "@google-cloud/datastore";
import { createHash } from "crypto";

export type ISODateString = string;

export type ArticleStatus =
  | "PENDING_FETCH"
  | "FETCHED"
  | "SUMMARIZED"
  | "FAILED";

export type SummaryStatus = "QUEUED" | "IN_PROGRESS" | "SUMMARIZED" | "FAILED";

export interface ArticleEntity {
  url: string;
  title: string;
  rawBody: string;
  status: ArticleStatus;
  sourceId: string;
  publishedAt: ISODateString;
  fetchedAt: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  failureReason?: string | null;
  summaryAttemptCount?: number;
}

export interface ArticleUpsertInput
  extends Omit<ArticleEntity, "createdAt" | "updatedAt"> {
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

export interface SummaryEntity {
  articleUrl: string;
  articleKey: string;
  status: SummaryStatus;
  summaryEn: string;
  summaryJa: string;
  tokensUsed?: number;
  costUsd?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  lastError?: string | null;
}

export interface SummaryUpsertInput
  extends Omit<SummaryEntity, "createdAt" | "updatedAt"> {
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

const ARTICLE_KIND = "Article";
const SUMMARY_KIND = "Summary";

let datastore: Datastore | null | undefined;
let initError: Error | null = null;

export function resetDatastoreClient() {
  datastore = undefined;
  initError = null;
}


export function getDatastore(projectId?: string): Datastore | null {
  if (datastore !== undefined) return datastore;
  try {
    datastore = new Datastore(
      projectId
        ? {
            projectId,
          }
        : undefined
    );
    initError = null;
    return datastore;
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error));
    datastore = null;
    return datastore;
  }
}

export function getDatastoreInitError(): Error | null {
  return initError;
}

function ensureDatastore(projectId?: string): Datastore {
  const ds = getDatastore(projectId);
  if (!ds) {
    throw initError ?? new Error("Datastore client is not initialized");
  }
  return ds;
}

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function articleKey(ds: Datastore, url: string): Key {
  return ds.key([ARTICLE_KIND, hashUrl(url)]);
}

function summaryKey(ds: Datastore, url: string): Key {
  return ds.key([SUMMARY_KIND, hashUrl(url)]);
}

function toDate(value: ISODateString | Date | undefined, fallback?: Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) return new Date(value);
  return fallback ?? new Date();
}

type DatastoreEntity = { [key: string]: any };

function fromArticleEntity(entity: DatastoreEntity): ArticleEntity {
  return {
    url: String(entity.url ?? ""),
    title: String(entity.title ?? ""),
    rawBody: String(entity.rawBody ?? ""),
    status: String(entity.status ?? "PENDING_FETCH") as ArticleStatus,
    sourceId: String(entity.sourceId ?? ""),
    publishedAt: toIsoString(entity.publishedAt),
    fetchedAt: toIsoString(entity.fetchedAt),
    createdAt: toIsoString(entity.createdAt),
    updatedAt: toIsoString(entity.updatedAt),
    failureReason: entity.failureReason ?? undefined,
    summaryAttemptCount: typeof entity.summaryAttemptCount === "number" ? entity.summaryAttemptCount : undefined,
  };
}

function fromSummaryEntity(entity: DatastoreEntity): SummaryEntity {
  return {
    articleUrl: String(entity.articleUrl ?? ""),
    articleKey: String(entity.articleKey ?? ""),
    status: String(entity.status ?? "QUEUED") as SummaryStatus,
    summaryEn: String(entity.summaryEn ?? ""),
    summaryJa: String(entity.summaryJa ?? ""),
    tokensUsed: typeof entity.tokensUsed === "number" ? entity.tokensUsed : undefined,
    costUsd: typeof entity.costUsd === "number" ? entity.costUsd : undefined,
    createdAt: toIsoString(entity.createdAt),
    updatedAt: toIsoString(entity.updatedAt),
    lastError: entity.lastError ?? undefined,
  };
}

function toIsoString(value: any): ISODateString {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function buildArticleEntity(input: ArticleUpsertInput): Record<string, unknown> {
  const now = new Date();
  return {
    url: input.url,
    title: input.title,
    rawBody: input.rawBody,
    status: input.status,
    sourceId: input.sourceId,
    publishedAt: toDate(input.publishedAt, now),
    fetchedAt: toDate(input.fetchedAt, now),
    createdAt: toDate(input.createdAt, now),
    updatedAt: toDate(input.updatedAt, now),
    failureReason: input.failureReason ?? null,
    summaryAttemptCount: input.summaryAttemptCount ?? 0,
  };
}

function buildSummaryEntity(input: SummaryUpsertInput): Record<string, unknown> {
  const now = new Date();
  return {
    articleUrl: input.articleUrl,
    articleKey: input.articleKey || hashUrl(input.articleUrl),
    status: input.status,
    summaryEn: input.summaryEn,
    summaryJa: input.summaryJa,
    tokensUsed: input.tokensUsed ?? null,
    costUsd: input.costUsd ?? null,
    createdAt: toDate(input.createdAt, now),
    updatedAt: toDate(input.updatedAt, now),
    lastError: input.lastError ?? null,
  };
}

export async function upsertArticle(input: ArticleUpsertInput, projectId?: string): Promise<ArticleEntity> {
  const ds = ensureDatastore(projectId);
  const key = articleKey(ds, input.url);
  const entity = buildArticleEntity(input);
  await ds.save({ key, data: entity });
  return {
    ...(await getArticleByUrl(input.url, projectId))!,
  };
}

export async function getArticleByUrl(url: string, projectId?: string): Promise<ArticleEntity | null> {
  const ds = ensureDatastore(projectId);
  const key = articleKey(ds, url);
  const [entity] = await ds.get(key);
  if (!entity) return null;
  return fromArticleEntity(entity);
}

export async function incrementArticleSummaryAttemptCount(url: string, projectId?: string): Promise<ArticleEntity | null> {
  const ds = ensureDatastore(projectId);
  const key = articleKey(ds, url);
  const tx = ds.transaction();
  await tx.run();
  try {
    const [entity] = await tx.get(key);
    if (!entity) {
      await tx.rollback();
      return null;
    }
    const count = typeof entity.summaryAttemptCount === "number" ? entity.summaryAttemptCount + 1 : 1;
    const merged = {
      ...entity,
      summaryAttemptCount: count,
      updatedAt: new Date(),
    };
    tx.save({ key, data: merged });
    await tx.commit();
    return fromArticleEntity(merged as DatastoreEntity);
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function recordArticleFailure(
  url: string,
  reason: string,
  projectId?: string
): Promise<ArticleEntity | null> {
  return updateArticleStatus(
    url,
    "FAILED",
    {
      failureReason: reason,
    },
    projectId
  );
}

export async function updateArticleStatus(
  url: string,
  status: ArticleStatus,
  changes: Partial<Omit<ArticleUpsertInput, "url">> = {},
  projectId?: string
): Promise<ArticleEntity | null> {
  const ds = ensureDatastore(projectId);
  const key = articleKey(ds, url);
  const tx = ds.transaction();
  await tx.run();
  try {
    const [entity] = await tx.get(key);
    if (!entity) {
      await tx.rollback();
      return null;
    }
    const merged = {
      ...entity,
      ...buildArticleEntity({
        ...(entity as Record<string, unknown>),
        ...changes,
        url,
        status,
        updatedAt: new Date().toISOString(),
        createdAt: toIsoString(entity.createdAt),
      } as ArticleUpsertInput),
      status,
      updatedAt: new Date(),
    };
    tx.save({ key, data: merged });
    await tx.commit();
    return fromArticleEntity(merged as DatastoreEntity);
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function listArticlesByStatus(
  status: ArticleStatus,
  options: { limit?: number; projectId?: string } = {}
): Promise<ArticleEntity[]> {
  const { limit = 50, projectId } = options;
  const ds = ensureDatastore(projectId);
  let query: Query = ds.createQuery(ARTICLE_KIND).filter("status", status).order("updatedAt", {
    descending: true,
  });
  if (limit > 0) query = query.limit(limit);
  const [entities] = await ds.runQuery(query);
  return entities.map(fromArticleEntity);
}

export async function upsertSummary(input: SummaryUpsertInput, projectId?: string): Promise<SummaryEntity> {
  const ds = ensureDatastore(projectId);
  const key = summaryKey(ds, input.articleUrl);
  const entity = buildSummaryEntity(input);
  await ds.save({ key, data: entity });
  return {
    ...(await getSummaryByArticleUrl(input.articleUrl, projectId))!,
  };
}

export async function getSummaryByArticleUrl(url: string, projectId?: string): Promise<SummaryEntity | null> {
  const ds = ensureDatastore(projectId);
  const key = summaryKey(ds, url);
  const [entity] = await ds.get(key);
  if (!entity) return null;
  return fromSummaryEntity(entity);
}

export async function updateSummaryStatus(
  url: string,
  status: SummaryStatus,
  changes: Partial<Omit<SummaryUpsertInput, "articleUrl" | "articleKey" | "status">> = {},
  projectId?: string
): Promise<SummaryEntity | null> {
  const ds = ensureDatastore(projectId);
  const key = summaryKey(ds, url);
  const tx = ds.transaction();
  await tx.run();
  try {
    const [entity] = await tx.get(key);
    if (!entity) {
      await tx.rollback();
      return null;
    }
    const merged = {
      ...entity,
      ...buildSummaryEntity({
        ...(entity as Record<string, unknown>),
        ...changes,
        articleUrl: url,
        articleKey: entity.articleKey ?? hashUrl(url),
        status,
        updatedAt: new Date().toISOString(),
        createdAt: toIsoString(entity.createdAt),
      } as SummaryUpsertInput),
      status,
      updatedAt: new Date(),
    };
    tx.save({ key, data: merged });
    await tx.commit();
    return fromSummaryEntity(merged as DatastoreEntity);
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function listSummariesByStatus(
  status: SummaryStatus,
  options: { limit?: number; projectId?: string } = {}
): Promise<SummaryEntity[]> {
  const { limit = 50, projectId } = options;
  const ds = ensureDatastore(projectId);
  let query: Query = ds.createQuery(SUMMARY_KIND).filter("status", status).order("updatedAt", {
    descending: true,
  });
  if (limit > 0) query = query.limit(limit);
  const [entities] = await ds.runQuery(query);
  return entities.map(fromSummaryEntity);
}

export function buildArticleKeyFromUrl(url: string, projectId?: string): Key {
  const ds = ensureDatastore(projectId);
  return articleKey(ds, url);
}

export function buildSummaryKeyFromUrl(url: string, projectId?: string): Key {
  const ds = ensureDatastore(projectId);
  return summaryKey(ds, url);
}
