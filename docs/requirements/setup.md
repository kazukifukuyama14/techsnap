# 構築手順書（Cloud Run 構成）

## 1. 前提条件

### 必要なツール

- Node.js 18 以上
- npm / npx
- Docker（コンテナビルド用）
- Google Cloud SDK（`gcloud`）
- GitHub CLI／Actions（任意、CI 用）

### 必要なアカウント / リソース

- GCP プロジェクト（staging / production）
- Artifact Registry（Docker リポジトリ）
- Firestore（キャッシュ用、ネイティブモード）
- OpenAI / DeepL など外部 API キー

---

## 2. リポジトリ取得と依存関係

```bash
git clone https://github.com/your-account/techsnap.git
cd techsnap
npm install
```

---

## 3. `.env` / シークレット設定

1. `apps/web/.env.local` を作成。例:
   ```env
   NEXT_PUBLIC_API_BASE=https://techsnap-api-staging-xxxxxxxx.a.run.app
   FIREBASE_PROJECT_ID=techsnap-staging
   FIREBASE_CLIENT_EMAIL=...
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   OPENAI_API_KEY=...
   DEEPL_API_KEY=...
   ```
2. 本番用は `.env.production` などを用意し、GitHub Actions / Cloud Run には Secret Manager から注入する。
3. サービスアカウント JSON は `secrets/` ディレクトリに保存し `.gitignore` 済み。

---

## 4. Docker ビルド

### 4.1 フロントエンド

`apps/web/Dockerfile` の例:

```Dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install --omit=dev
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/apps/web/.next ./.next
COPY --from=base /app/apps/web/package.json ./package.json
COPY --from=base /app/apps/web/public ./public
RUN npm install --omit=dev
EXPOSE 8080
CMD ["npm", "run", "start"]
```

### 4.2 バックエンド（要約 API）

`apps/api` に要約ロジックのみをまとめ、Express などで HTTP API を提供。`Dockerfile` はフロントと同様に Node 20 ベースでビルドする。

---

## 5. Artifact Registry へのプッシュ

```bash
# ステージング例
STAGING_PROJECT=techsnap-staging
REGION=asia-northeast1
REPO=techsnap-web

gcloud artifacts repositories create $REPO \
  --repository-format=docker \
  --location=$REGION \
  --description="TechSnap containers"  # 初回のみ

gcloud builds submit apps/web \
  --tag $REGION-docker.pkg.dev/$STAGING_PROJECT/$REPO/frontend:latest

gcloud builds submit apps/api \
  --tag $REGION-docker.pkg.dev/$STAGING_PROJECT/$REPO/backend:latest
```

---

## 6. Cloud Run へデプロイ

```bash
# フロントエンド
gcloud run deploy techsnap-frontend \
  --image $REGION-docker.pkg.dev/$STAGING_PROJECT/$REPO/frontend:latest \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars NEXT_PUBLIC_API_BASE=https://techsnap-api-staging-xxxxxxxx.a.run.app

# バックエンド
gcloud run deploy techsnap-api \
  --image $REGION-docker.pkg.dev/$STAGING_PROJECT/$REPO/backend:latest \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars OPENAI_API_KEY=... \
  --set-env-vars DEEPL_API_KEY=... \
  --set-env-vars FIREBASE_PROJECT_ID=... \
  --set-env-vars FIREBASE_CLIENT_EMAIL=... \
  --set-env-vars FIREBASE_PRIVATE_KEY="..."
```

Secret Manager を使う場合は `--set-secrets` オプションを利用してください。

---

## 7. GitHub Actions（任意）

- Docker ビルドと `gcloud run deploy` を自動化するワークフローを作成する。
- キャッシュウォーミング用の `prefetch-feeds` ワークフローは継続利用できる。
- 必要なシークレット（GCP サービスアカウントキー、API キー）を GitHub Secrets に登録。

---

## 8. Terraform への落とし込み（任意）

- Artifact Registry / Cloud Run / IAM / Secret Manager を Terraform で管理する。
- 手動で構築した設定を `terraform import` してコード化すると移行がスムーズ。

---

## 9. 動作確認

1. Cloud Run にアクセスして一覧が表示されるか確認。
2. 要約 API を `curl https://techsnap-api-staging-.../enrich` などで動作確認。
3. Firestore にキャッシュが作成されているかチェック。

---

## 10. クリーンアップ

- 旧 Firebase Hosting / Functions / Storage など不要になったリソースは削除。
- Cloud Run の未使用リビジョンや Artifact Registry の古いイメージはクリーンアップポリシーで自動削除。
