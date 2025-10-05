"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const datastore_1 = require("@google-cloud/datastore");
const openai_1 = __importDefault(require("openai"));
const deepl_node_1 = require("deepl-node");
const config_1 = require("./config");
const rss_1 = require("./rss");
const article_1 = require("./article");
const datastore_2 = require("./datastore");
const summarizer_1 = require("./summarizer");
async function main() {
    const config = (0, config_1.loadConfig)();
    if (config.feeds.length === 0) {
        console.log("[summarizer] No RSS feeds configured. Exiting.");
        return;
    }
    const datastore = new datastore_1.Datastore({ projectId: config.projectId });
    const openai = new openai_1.default({ apiKey: config.openAi.apiKey });
    const translator = new deepl_node_1.Translator(config.deepl.apiKey);
    const { default: pLimit } = await import("p-limit");
    const candidates = await collectCandidates(config.feeds, config.maxItems);
    if (candidates.length === 0) {
        console.log("[summarizer] No new articles found.");
        return;
    }
    console.log("[summarizer] processing candidates", candidates.map((c) => ({ title: c.title, link: c.link })));
    const limit = pLimit(config.concurrency || 1);
    const results = await Promise.all(candidates.map((candidate) => limit(() => processCandidate({
        config,
        datastore,
        openai,
        translator,
        candidate,
    }))));
    const succeeded = results.filter((r) => r === true).length;
    const failed = results.filter((r) => r === false).length;
    console.log(`[summarizer] done. success=${succeeded} failed=${failed}`);
}
async function collectCandidates(feeds, maxItems) {
    const items = await Promise.all(feeds.map((feed) => (0, rss_1.fetchFeedItems)(feed, maxItems)));
    const map = new Map();
    for (const item of items.flat()) {
        if (!map.has(item.link)) {
            map.set(item.link, item);
        }
    }
    return Array.from(map.values()).slice(0, maxItems);
}
async function processCandidate({ config, datastore, openai, translator, candidate, }) {
    try {
        const existingSummary = await (0, datastore_2.getSummary)(datastore, candidate.link);
        if (existingSummary?.status === "SUMMARIZED") {
            console.log(`[summarizer] skip existing summary: ${candidate.link}`);
            return true;
        }
        const existingArticle = await (0, datastore_2.getArticle)(datastore, candidate.link);
        if (existingArticle?.status === "FAILED" &&
            existingArticle.summaryAttemptCount &&
            existingArticle.summaryAttemptCount > 3) {
            console.log(`[summarizer] skip permanently failed article: ${candidate.link}`);
            return true;
        }
        const articleContent = await (0, article_1.buildArticleContent)(candidate, config.fetchTimeoutMs);
        if (!articleContent) {
            await (0, datastore_2.recordArticleFailure)(datastore, candidate.link, "Empty article body");
            return false;
        }
        await (0, datastore_2.upsertArticle)(datastore, {
            url: articleContent.url,
            title: articleContent.title,
            rawBody: articleContent.body,
            sourceId: articleContent.sourceId,
            publishedAt: articleContent.publishedAt,
            fetchedAt: new Date().toISOString(),
        });
        await (0, datastore_2.updateArticleStatus)(datastore, articleContent.url, "IN_PROGRESS");
        const result = await (0, summarizer_1.generateSummary)({
            openai,
            translator,
            model: config.openAi.model,
            systemPrompt: config.openAi.systemPrompt,
            targetLang: config.deepl.targetLang,
            formality: config.deepl.formality,
        }, articleContent.body);
        await (0, datastore_2.upsertSummary)(datastore, {
            articleUrl: articleContent.url,
            summaryEn: result.summaryEn,
            summaryJa: result.summaryJa,
            tokensUsed: result.tokensUsed,
            costUsd: result.costUsd,
            status: "SUMMARIZED",
        });
        await (0, datastore_2.updateArticleStatus)(datastore, articleContent.url, "SUMMARIZED", {
            failureReason: null,
            summaryAttemptCount: (existingArticle?.summaryAttemptCount || 0) + 1,
        });
        console.log(`[summarizer] summarized ${articleContent.url}`, {
            tokens: result.tokensUsed,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
        });
        return true;
    }
    catch (error) {
        console.error(`[summarizer] failed to summarize ${candidate.link}`, error);
        const message = error instanceof Error ? error.message : String(error);
        await (0, datastore_2.recordArticleFailure)(datastore, candidate.link, message);
        await (0, datastore_2.upsertSummary)(datastore, {
            articleUrl: candidate.link,
            summaryEn: "",
            summaryJa: "",
            status: "FAILED",
            tokensUsed: undefined,
            costUsd: undefined,
            lastError: message,
        });
        return false;
    }
}
main().catch((error) => {
    console.error("[summarizer] job failed", error);
    process.exitCode = 1;
});
