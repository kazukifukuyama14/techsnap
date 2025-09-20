# 要件定義書

## 要件 1 アプリケーション機能

1. ユーザーは技術ブログ/ドキュメントの更新を一覧で閲覧できる。
2. 各記事の要約は 1 文で表示され、日本語訳を提供する。
3. 記事の原文リンク・公開日時・タグを確認できる。
4. 翻訳や要約でエラーが発生した場合でも、一覧は崩れず原文情報でフォールバックする。

## 要件 2 データ取得とキャッシュ

1. RSS/Atom/JSON Feed から 1 日単位で記事を収集できる。
2. 取得した記事は Firestore（GCP）にキャッシュされ、再取得コストを抑える。
3. キャッシュは 6 時間を目安に期限管理される。
4. 手動/自動で要約キャッシュを再生成できる。

## 要件 3 ホスティングと配信

1. Next.js フロントエンドは Cloud Run（コンテナ）で提供する。
2. 要約 API も Cloud Run 上のコンテナとして稼働し、フロントから HTTPS 経由で呼び出せる。
3. ビルド済みコンテナは Artifact Registry に保存し、Cloud Run へロールアウトできる。
4. カスタムドメインや HTTPS 設定は Cloud Run / Cloud Load Balancer を利用して管理する。

## 要件 4 運用・監視

1. Cloud Run のメトリクス／ログを利用し、日次で稼働状況を確認できる。
2. Firestore に保存されたキャッシュは一括削除や再生成が可能である。
3. GitHub Actions の実行ログからキャッシュウォーミングやデプロイ状況を確認できる。
4. コストは Cloud Billing レポートで把握し、無料枠内に収めることを意識する。

## 要件 5 自動処理

1. GitHub Actions を用いて 1 時間ごとに `scripts/fetch-feeds.mjs` を実行し、最新データをウォームアップする。
2. 手動実行時は `force_refresh` オプションでキャッシュを強制更新できる。
3. デプロイ用の CI では Docker イメージをビルドし、Artifact Registry / Cloud Run へプッシュできる。
4. 自動処理に必要なシークレットは GitHub Secrets と Secret Manager で管理する。

## 要件 6 セキュリティ

1. Firestore への書き込みはバックエンド（Cloud Run API）に限定する。
2. Cloud Run サービスアカウントは最小権限とし、API キーや秘密情報は Secret Manager 経由で注入する。
3. 外部 API キー（OpenAI / DeepL）は `.env` や Secrets に保存し、リポジトリに含めない。
4. Cloud Run の公開範囲（認証有無）を明示し、不要なエンドポイントは非公開にする。

## 要件 7 パフォーマンスと UX

1. 一覧表示は 1 秒以内のレスポンスを目標とし、ローディング表示を実装する。
2. モバイル/デスクトップ双方でのレイアウト最適化を行う。
3. 30 件以上の記事を段階的に表示できる無限スクロールまたはページネーションを用意する。
4. API 呼び出しは Cloud Run のスケーリング特性を踏まえてタイムアウトやリトライを管理する。

## 要件 8 ドキュメント

1. セットアップ手順（Docker ビルド、Artifact Registry、Cloud Run デプロイ）を README / `docs/requirements/setup.md` に明記する。
2. 運用手順（日次/週次チェック、GitHub Actions の手動実行方法）を `docs/operation/operations.md` にまとめる。
3. アーキテクチャとデータフローは `docs/design/design.md` で Cloud Run ベースとして図示する。
4. 変更履歴は Git で追跡可能とし、重要な環境変更はドキュメントに反映する。
