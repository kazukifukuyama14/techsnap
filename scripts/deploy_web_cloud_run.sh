#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your GCP project id}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-techsnap-web}"
REPOSITORY="${REPOSITORY:-web}"
TAG="${TAG:-$(date +%Y%m%d%H%M%S)}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${TAG}"

gcloud config set project "$PROJECT_ID" >/dev/null

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Docker images for ${SERVICE_NAME}"
fi

gcloud builds submit \
  --project "$PROJECT_ID" \
  --tag "$IMAGE_URI" \
  --file apps/web/Dockerfile \
  .

deploy_flags=(
  --project "$PROJECT_ID"
  --region "$REGION"
  --image "$IMAGE_URI"
  --platform managed
  --allow-unauthenticated
  --port 8080
)

# 実行時設定をカンマ区切りの KEY=VALUE で渡したい場合に使用
if [[ -n "${CLOUD_RUN_ENV_VARS:-}" ]]; then
  deploy_flags+=(--set-env-vars "$CLOUD_RUN_ENV_VARS")
fi

if [[ -n "${CLOUD_RUN_SERVICE_ACCOUNT:-}" ]]; then
  deploy_flags+=(--service-account "$CLOUD_RUN_SERVICE_ACCOUNT")
fi

gcloud run deploy "$SERVICE_NAME" "${deploy_flags[@]}"
