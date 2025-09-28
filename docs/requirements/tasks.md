# 実装計画（Cloud Run 構成）

- [x] 1. プロジェクト基盤セットアップ

  - Next.js + Tailwind CSS の初期化
  - TypeScript / ESLint / Prettier の整備
  - ディレクトリ構造（`apps/web`, `infra/techsnap`, `.github/workflows`）の確立

- [x] 2. インフラ環境構築（staging / production）

  - GCP プロジェクト・課金設定
  - Artifact Registry（staging/prod）リポジトリ作成
  - Cloud Run 用サービスアカウント & IAM（Artifact Registry Writer 権限）
  - Terraform で Artifact Registry / IAM / VPC などをコード化

- [ ] 3. Cloud Run デプロイ

  - `apps/web/Dockerfile` を Cloud Run 向けに最適化
  - 手動 `gcloud run deploy` 手順を確立（staging → prod）
  - 今後の自動デプロイワークフローを追加検討

- [x] 4. フロントエンド機能

  - `/api/enrich` で記事本文抽出・OpenAI 要約・DeepL 翻訳を実装
  - 英語/日本語要約のフォールバック＆文字数制限を実装
  - `.next/cache/enrich.json` を利用したリビジョン内キャッシュを実装

- [ ] 5. キャッシュと永続化

  - 永続ストア（Firestore / Memorystore 等）への移行方針を検討
  - キャッシュ再生成手順とモニタリング項目を整備

- [x] 6. CI（Build & Push）

  - GitHub Actions `build-and-push.yml` を作成（staging=自動 / prod=手動）
  - GitHub Variables / Secrets（`GCP_AR_*`, `GCP_PROJECT_ID_*`、サービスアカウントキー）を設定
  - Artifact Registry のクリーンアップポリシーを Terraform に反映

- [ ] 7. 運用・ドキュメント
  - Cloud Run 監視 & ログ確認フローを整備
  - 手動デプロイ / ロールバック手順を `docs/operation/operations.md` に反映（済）
  - 今後の自動デプロイ・永続キャッシュ等の改善項目を追記
