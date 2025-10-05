import { Datastore } from "@google-cloud/datastore";
import OpenAI from "openai";
import { Translator } from "deepl-node";
import { loadConfig, SummarizerConfig } from "./config";
import { fetchFeedItems } from "./rss";
import { buildArticleContent } from "./article";
import {
  getArticle,
  getSummary,
  recordArticleFailure,
  upsertArticle,
  upsertSummary,
  updateArticleStatus,
  updateSummaryStatus,
} from "./datastore";
import { generateSummary } from "./summarizer";
import { FeedItemCandidate } from "./types";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.feeds.length === 0) {
    console.log("[summarizer] No RSS feeds configured. Exiting.");
    return;
  }

  const datastore = new Datastore({ projectId: config.projectId });
  const openai = new OpenAI({ apiKey: config.openAi.apiKey });
  const translator = new Translator(config.deepl.apiKey);
  const { default: pLimit } = await import("p-limit");

  const candidates = await collectCandidates(config.feeds, config.maxItems);
  if (candidates.length === 0) {
    console.log("[summarizer] No new articles found.");
    return;
  }

  console.log(
    "[summarizer] processing candidates",
    candidates.map((c) => ({ title: c.title, link: c.link }))
  );

  const limit = pLimit(config.concurrency || 1);
  const results = await Promise.all(
    candidates.map((candidate) =>
      limit(() =>
        processCandidate({
          config,
          datastore,
          openai,
          translator,
          candidate,
        })
      )
    )
  );

  const succeeded = results.filter((r) => r === true).length;
  const failed = results.filter((r) => r === false).length;
  console.log(`[summarizer] done. success=${succeeded} failed=${failed}`);
}

async function collectCandidates(
  feeds: string[],
  maxItems: number
): Promise<FeedItemCandidate[]> {
  const items = await Promise.all(
    feeds.map((feed) => fetchFeedItems(feed, maxItems))
  );
  const map = new Map<string, FeedItemCandidate>();
  for (const item of items.flat()) {
    if (!map.has(item.link)) {
      map.set(item.link, item);
    }
  }
  return Array.from(map.values()).slice(0, maxItems);
}

async function processCandidate({
  config,
  datastore,
  openai,
  translator,
  candidate,
}: {
  config: SummarizerConfig;
  datastore: Datastore;
  openai: OpenAI;
  translator: Translator;
  candidate: FeedItemCandidate;
}): Promise<boolean> {
  try {
    const existingSummary = await getSummary(datastore, candidate.link);
    if (existingSummary?.status === "SUMMARIZED") {
      console.log(`[summarizer] skip existing summary: ${candidate.link}`);
      return true;
    }

    const existingArticle = await getArticle(datastore, candidate.link);
    if (
      existingArticle?.status === "FAILED" &&
      existingArticle.summaryAttemptCount &&
      existingArticle.summaryAttemptCount > 3
    ) {
      console.log(
        `[summarizer] skip permanently failed article: ${candidate.link}`
      );
      return true;
    }

    const articleContent = await buildArticleContent(
      candidate,
      config.fetchTimeoutMs
    );
    if (!articleContent) {
      await recordArticleFailure(
        datastore,
        candidate.link,
        "Empty article body"
      );
      return false;
    }

    await upsertArticle(datastore, {
      url: articleContent.url,
      title: articleContent.title,
      rawBody: articleContent.body,
      sourceId: articleContent.sourceId,
      publishedAt: articleContent.publishedAt,
      fetchedAt: new Date().toISOString(),
    });

    await updateArticleStatus(datastore, articleContent.url, "IN_PROGRESS");

    const result = await generateSummary(
      {
        openai,
        translator,
        model: config.openAi.model,
        systemPrompt: config.openAi.systemPrompt,
        targetLang: config.deepl.targetLang,
        formality: config.deepl.formality,
      },
      articleContent.body
    );

    await upsertSummary(datastore, {
      articleUrl: articleContent.url,
      summaryEn: result.summaryEn,
      summaryJa: result.summaryJa,
      tokensUsed: result.tokensUsed,
      costUsd: result.costUsd,
      status: "SUMMARIZED",
    });
    await updateArticleStatus(datastore, articleContent.url, "SUMMARIZED", {
      failureReason: null,
      summaryAttemptCount: (existingArticle?.summaryAttemptCount || 0) + 1,
    });

    console.log(`[summarizer] summarized ${articleContent.url}`, {
      tokens: result.tokensUsed,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    });
    return true;
  } catch (error) {
    console.error(`[summarizer] failed to summarize ${candidate.link}`, error);
    const message = error instanceof Error ? error.message : String(error);
    await recordArticleFailure(datastore, candidate.link, message);
    await upsertSummary(datastore, {
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
