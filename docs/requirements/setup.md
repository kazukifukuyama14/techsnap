# 構築手順書（Cloud Run 構成）

## 1. 前提条件

### 必要なツール

- Node.js 20 系
- npm
- Docker Desktop などコンテナ実行環境
- Google Cloud SDK (`gcloud`)
- GitHub CLI（任意 / Actions の手動実行で利用）

### 必要なリソース

- GCP プロジェクト（staging / production）
- Artifact Registry（Docker リポジトリ）
- Cloud Run（要約アプリをホスト）
- OpenAI / DeepL API キー
- GitHub リポジトリ（Actions で利用）

---

## 2. リポジトリ取得と依存関係

```bash
git clone https://github.com/kazukifukuyama14/techsnap.git
cd techsnap
npm install
```

---

## 3. `.env` / シークレット設定

1. `apps/web/.env.local` を作成し、以下を設定します。
   ```env
   OPENAI_API_KEY=sk-...
   OPENAI_TRANSLATE_MODEL=gpt-4o-mini
   TRANSLATION_PROVIDER=deepl
   DEEPL_API_KEY=your-deepl-key
   FIREBASE_SERVICE_ACCOUNT_FILE=secrets/firebase-admin-staging.json  # 必要に応じて
   FEED_CRON_ORIGIN=https://techsnap-staging.web.app
   ```
   ※ Firebase を利用しない場合は不要な項目を削除して構いません。
2. 本番用のキーは `.env.production` など別ファイルにし、Cloud Run では Secret Manager 経由で注入します。
3. GitHub Actions で利用するシークレット
   - `GCP_AR_PUSHER_KEY_STG` / `GCP_AR_PUSHER_KEY_PRD`: Artifact Registry へ push 可能なサービスアカウント JSON
   - リポジトリ変数として `GCP_PROJECT_ID_STG/PRD`, `GCP_AR_LOCATION_STG/PRD`, `GCP_AR_REPO_STG/PRD`
   - 必要に応じて `OPENAI_API_KEY`, `DEEPL_API_KEY` も Actions Secrets に追加

---

## 4. Docker ビルド

`apps/web/Dockerfile` はマルチステージ構成です。ローカル確認:

```bash
docker build -f apps/web/Dockerfile -t techsnap-web ./apps/web
docker run --rm -p 3000:3000 --env-file apps/web/.env.local techsnap-web
```

---

## 5. Artifact Registry へのプッシュ

Terraform (`infra/techsnap`) でリポジトリを作成済みの場合はスキップできます。手動で push する場合は以下を参考にしてください。

```bash
REGION=asia-northeast1
PROJECT=techsnap-staging
REPO=techsnap-staging-repo

gcloud builds submit apps/web \
  --tag $REGION-docker.pkg.dev/$PROJECT/$REPO/web:manual
```

prod 環境も同様に `PROJECT`/`REPO` を切り替えて実行します。

---

## 6. Cloud Run へデプロイ

```bash
REGION=asia-northeast1
PROJECT=techsnap-staging
REPO=techsnap-staging-repo

IMAGE_URI=$REGION-docker.pkg.dev/$PROJECT/$REPO/web:manual
gcloud run deploy techsnap-web \
  --image $IMAGE_URI \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars OPENAI_API_KEY=@@SECRET(OPENAI)@@,DEEPL_API_KEY=@@SECRET(DEEPL)@@
```

※ 実際には `--set-secrets` で Secret Manager から注入することを推奨します。

---

## 7. GitHub Actions

`.github/workflows/build-and-push.yml` が staging / prod 向けのビルド & push を定義しています。

- staging: `main` ブランチへの push で自動実行
- prod: `workflow_dispatch` を開き `target_environment=prod`、`confirm_prod=deploy` を入力して手動実行

今後 Cloud Run への自動デプロイを追加予定です。現状は Artifact Registry に push されたイメージを手動でデプロイしてください。

---

## 8. Terraform（任意）

`infra/techsnap` ディレクトリのモジュールで以下のリソースを管理できます。

- Artifact Registry（staging/prod）
- IAM ロール付与（Cloud Run サービスアカウントに Artifact Registry Writer 追加）
- VPC やファイアウォール（将来的な拡張用）

必要に応じて `terraform init -reconfigure -backend-config=env/<env>.backend.hcl` で環境を切り替え、`terraform apply -var-file=env/<env>.tfvars` を実行してください。

---

## 9. 動作確認

1. Cloud Run の URL にアクセスし、記事一覧が表示されることを確認。
2. 要約が英語 1 文 + 日本語訳 1 文で表示されているか確認。
3. GitHub Actions の `Build and Push Container` が成功し、Artifact Registry にイメージが存在するか確認。

---

## 10. クリーンアップ

- 使わなくなった Cloud Run リビジョンや Artifact Registry の不要タグを削除。
- Secrets をローテーションし、不要なサービスアカウントキーは無効化。
- Terraform 管理の場合は `terraform destroy` で一括削除可能。
