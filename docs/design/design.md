# 設計書

## 概要

技術記事要約サービス「TechSnap」は Next.js (App Router) + TypeScript を基盤とした単一コンテナ構成です。Next.js 内部の API Route が記事要約と翻訳を担当し、OpenAI / DeepL API を呼び出して結果を生成します。要約結果はコンテナ内のキャッシュファイルに保存され、同一リビジョン内で再利用されます（将来的に Firestore など永続キャッシュへ移行予定）。

## アーキテクチャ

```mermaid
graph TB
  User((User)) --> Web[Cloud Run: techsnap-web]
  Web --> OpenAI[OpenAI API]
  Web --> DeepL[DeepL API]

  subgraph "Build & Release"
    GitHub[GitHub Actions]
    AR[Artifact Registry (staging/prod)]
    GitHub --> AR
    AR --> Web
  end
```

- `techsnap-web`: Next.js サービス。ページ表示と `/api/enrich` による要約処理を同一コンテナで実装。
- キャッシュ: `.next/cache/enrich.json` に一時保存。リビジョン単位で保持し、外部ストアは未使用。
- GitHub Actions: Docker イメージのビルドと Artifact Registry への push を担当（staging 自動 / prod 手動）。

## データフロー

1. GitHub Actions が `apps/web/Dockerfile` を用いてイメージをビルドし、staging/prod 用 Artifact Registry へ push。
2. Cloud Run (予定) またはローカルコンテナにデプロイされた `techsnap-web` がリクエストを受け付け、`/api/enrich` で要約処理を実行。
3. `/api/enrich` は対象記事の本文を取得し、OpenAI で英語要約 → DeepL で日本語化。失敗時はフォールバックロジックを使用。
4. 要約結果は `.next/cache/enrich.json` に保存され、同一リビジョン内で再利用される。

## モジュール構成

| モジュール / ディレクトリ     | 役割                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `apps/web`                    | Next.js 本体。App Router + `/api/enrich` で要約と翻訳を実装。                 |
| `apps/web/src/app/api/enrich` | 記事本文の抽出、OpenAI / DeepL API 連携、要約キャッシュ制御。                 |
| `apps/web/Dockerfile`         | マルチステージ構成で SSR 向けコンテナをビルド。                               |
| `.github/workflows`           | `build-and-push.yml` が staging/prod 向けのビルド＆push 処理を定義。          |
| `infra/techsnap`              | Terraform モジュール。Artifact Registry / IAM / VPC など GCP リソースを管理。 |

## 環境

| 環境       | コンテナ / サービス         | Artifact Registry リポジトリ                                            | 備考                             |
| ---------- | --------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| staging    | `techsnap-web` (staging)    | `asia-northeast1-docker.pkg.dev/techsnap-staging/techsnap-staging-repo` | `main` ブランチ push で自動 push |
| production | `techsnap-web` (production) | `asia-northeast1-docker.pkg.dev/techsnap-prod/techsnap-prod-repo`       | `workflow_dispatch` で手動 push  |

## デプロイ戦略

1. GitHub Actions の `build-and-push.yml` が `apps/web` をビルドし、staging/prod 用リポジトリへ push。
2. staging: `main` への push で自動実行。prod: `workflow_dispatch` で `target_environment=prod`,`confirm_prod=deploy` を指定して手動実行。
3. Cloud Run へのデプロイは `gcloud run deploy --image <IMAGE_URI>` を用いた手動 or 今後追加予定のワークフローで実施。
4. Artifact Registry のクリーンアップは Terraform の `cleanup_policies` で最新 2 件を保持し、それ以外を削除。

## 今後の改善ポイント

- Cloud Run への自動デプロイ手順の実装（現在は手動デプロイ想定）。
- Firestore や Secret Manager 等へのキャッシュ/シークレット移行によるリビジョン跨ぎの安定化。
- Cloud Load Balancer + Cloud CDN を組み合わせた配信最適化。
