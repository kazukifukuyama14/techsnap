import {
  getDatastore,
  resetDatastoreClient,
  upsertArticle,
  getArticleByUrl,
  listArticlesByStatus,
  incrementArticleSummaryAttemptCount,
  recordArticleFailure,
  upsertSummary,
  getSummaryByArticleUrl,
  listSummariesByStatus,
  updateSummaryStatus,
  ArticleStatus,
  SummaryStatus,
} from "../../lib/datastore";

async function main() {
  const projectId =
    process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error("Set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT to run the Datastore PoC script");
  }

  resetDatastoreClient();
  const ds = getDatastore(projectId);
  if (!ds) throw new Error("Failed to initialize Datastore client");

  const url = "https://example.com/articles/hello-world";

  const article = await upsertArticle(
    {
      url,
      title: "Hello Datastore",
      rawBody: "<p>Sample article body</p>",
      status: "FETCHED",
      sourceId: "sample-feed",
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    projectId
  );
  console.log("Upserted article", article);

  await incrementArticleSummaryAttemptCount(url, projectId);
  await incrementArticleSummaryAttemptCount(url, projectId);

  const fetched = await getArticleByUrl(url, projectId);
  console.log("Fetched article", fetched);

  const queued = await listArticlesByStatus("FETCHED", { limit: 5, projectId });
  console.log("Articles with status FETCHED", queued.length);

  const summary = await upsertSummary(
    {
      articleUrl: url,
      articleKey: "",
      status: "IN_PROGRESS",
      summaryEn: "Pending",
      summaryJa: "保留",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    projectId
  );
  console.log("Upserted summary", summary);

  await updateSummaryStatus(
    url,
    "SUMMARIZED",
    {
      summaryEn: "Hello world summary",
      summaryJa: "こんにちは世界の要約",
      tokensUsed: 123,
      costUsd: 0.12,
    },
    projectId
  );

  const completedSummaries = await listSummariesByStatus("SUMMARIZED", { limit: 5, projectId });
  console.log("Summaries with status SUMMARIZED", completedSummaries.length);

  const finalSummary = await getSummaryByArticleUrl(url, projectId);
  console.log("Final summary", finalSummary);

  await recordArticleFailure(url, "Sample failure for monitoring", projectId);
  const failedArticle = await getArticleByUrl(url, projectId);
  console.log("Failed article", failedArticle?.failureReason);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export type { ArticleStatus, SummaryStatus };
