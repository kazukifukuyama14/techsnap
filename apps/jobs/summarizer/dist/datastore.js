"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getArticle = getArticle;
exports.getSummary = getSummary;
exports.upsertArticle = upsertArticle;
exports.updateArticleStatus = updateArticleStatus;
exports.recordArticleFailure = recordArticleFailure;
exports.upsertSummary = upsertSummary;
exports.updateSummaryStatus = updateSummaryStatus;
const crypto_1 = __importDefault(require("crypto"));
const ARTICLE_KIND = "Article";
const SUMMARY_KIND = "Summary";
function hashUrl(url) {
    return crypto_1.default.createHash("sha256").update(url).digest("hex");
}
function articleKey(datastore, url) {
    return datastore.key([ARTICLE_KIND, hashUrl(url)]);
}
function summaryKey(datastore, url) {
    return datastore.key([SUMMARY_KIND, hashUrl(url)]);
}
function nowIso() {
    return new Date().toISOString();
}
async function getArticle(datastore, url) {
    const key = articleKey(datastore, url);
    const [entity] = await datastore.get(key);
    if (!entity)
        return null;
    return fromArticleEntity(entity);
}
async function getSummary(datastore, url) {
    const key = summaryKey(datastore, url);
    const [entity] = await datastore.get(key);
    if (!entity)
        return null;
    return fromSummaryEntity(entity);
}
async function upsertArticle(datastore, article) {
    const existing = await getArticle(datastore, article.url);
    const now = nowIso();
    const payload = {
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
async function updateArticleStatus(datastore, url, status, fields = {}) {
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
        const updated = {
            ...record,
            ...fields,
            status,
            updatedAt: nowIso(),
        };
        transaction.save({ key, data: updated });
        await transaction.commit();
        return updated;
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}
async function recordArticleFailure(datastore, url, reason) {
    const current = await getArticle(datastore, url);
    const attempts = (current?.summaryAttemptCount || 0) + 1;
    return updateArticleStatus(datastore, url, "FAILED", {
        failureReason: reason,
        summaryAttemptCount: attempts,
    });
}
async function upsertSummary(datastore, summary) {
    const existing = await getSummary(datastore, summary.articleUrl);
    const now = nowIso();
    const payload = {
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
async function updateSummaryStatus(datastore, url, status, fields = {}) {
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
        const updated = {
            ...record,
            ...fields,
            status,
            updatedAt: nowIso(),
        };
        transaction.save({ key, data: updated });
        await transaction.commit();
        return updated;
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
}
function fromArticleEntity(entity) {
    return {
        url: String(entity.url),
        title: String(entity.title || ""),
        rawBody: String(entity.rawBody || ""),
        status: (entity.status || "PENDING_FETCH"),
        sourceId: String(entity.sourceId || ""),
        publishedAt: toIso(entity.publishedAt),
        fetchedAt: toIso(entity.fetchedAt),
        createdAt: toIso(entity.createdAt),
        updatedAt: toIso(entity.updatedAt),
        failureReason: entity.failureReason ?? undefined,
        summaryAttemptCount: typeof entity.summaryAttemptCount === "number"
            ? entity.summaryAttemptCount
            : undefined,
    };
}
function fromSummaryEntity(entity) {
    return {
        articleUrl: String(entity.articleUrl || ""),
        articleKey: String(entity.articleKey || ""),
        status: (entity.status || "QUEUED"),
        summaryEn: String(entity.summaryEn || ""),
        summaryJa: String(entity.summaryJa || ""),
        tokensUsed: typeof entity.tokensUsed === "number" ? entity.tokensUsed : undefined,
        costUsd: typeof entity.costUsd === "number" ? entity.costUsd : undefined,
        createdAt: toIso(entity.createdAt),
        updatedAt: toIso(entity.updatedAt),
        lastError: entity.lastError ?? undefined,
    };
}
function toIso(value) {
    if (!value)
        return new Date(0).toISOString();
    if (value instanceof Date)
        return value.toISOString();
    return new Date(String(value)).toISOString();
}
