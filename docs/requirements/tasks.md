# 実装計画（Cloud Run 構成）

- [ ] 1. プロジェクト基盤セットアップ

  - Next.js プロジェクト初期化と Tailwind CSS 設定
  - TypeScript / ESLint / Prettier 設定
  - ディレクトリ構造（apps/web, apps/api, lib, scripts）整備

- [ ] 2. インフラ環境構築（staging / production）

  - GCP プロジェクト作成と課金設定
  - Artifact Registry（Docker）リポジトリ作成
  - Firestore（キャッシュ用）をネイティブモードで有効化
  - サービスアカウントと IAM 権限の付与

- [ ] 3. バックエンド API（Cloud Run）

  - 要約 API を Express などで実装（OpenAI / DeepL 連携）
  - Firestore キャッシュの CRUD 実装
  - Dockerfile 作成・コンテナビルド
  - Cloud Run へデプロイし、環境変数／Secret を設定

- [ ] 4. フロントエンド（Cloud Run）

  - UI コンポーネント（一覧、フィルタ、サイドバー）
  - `scripts/fetch-feeds.mjs` と API 呼び出しの整備
  - Dockerfile 作成・コンテナビルド
  - Cloud Run へデプロイし、API ベース URL を設定

- [ ] 5. キャッシュウォーミング

  - GitHub Actions で `scripts/fetch-feeds.mjs` を定期実行
  - `force_refresh` オプションを手動トリガーで利用可能にする
  - Firestore キャッシュの監視・クリーンアップ手順を策定

- [ ] 6. CI/CD（任意）

  - Docker イメージビルドと Cloud Run デプロイを自動化
  - Artifact Registry のクリーンアップポリシー設定
  - ステージング → 本番のロールアウト手順を明文化

- [ ] 7. ドキュメント／運用
  - セットアップ手順（本書）と運用ガイドを更新
  - アーキテクチャ図・データフローを Cloud Run 構成で更新
  - コスト／アラートの監視方法を整備
