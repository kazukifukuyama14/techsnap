import { deleteArticleByUrl, deleteSummaryByArticleUrl, resetDatastoreClient, getDatastore } from "../../lib/datastore";

const TARGET_URL = process.argv[2] || "https://example.com/articles/hello-world";

async function main() {
  const projectId =
    process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error("Set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT before running cleanup script");
  }

  resetDatastoreClient();
  const ds = getDatastore(projectId);
  if (!ds) throw new Error("Failed to initialize Datastore client");

  await deleteSummaryByArticleUrl(TARGET_URL, projectId);
  await deleteArticleByUrl(TARGET_URL, projectId);
  console.log(`Deleted Article/Summary for ${TARGET_URL} in ${projectId}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
