# 要件定義書

## 要件 1 アプリケーション機能

1. ユーザーは技術ブログ/ドキュメントの更新を一覧で閲覧できる。
2. 各記事の要約は 1 文で表示され、日本語訳を提供する。
3. 記事の原文リンク・公開日時・タグを確認できる。
4. 翻訳や要約でエラーが発生した場合でも、一覧は崩れず原文情報でフォールバックする（英語要約 + 英文タイトル）。

## 要件 2 データ取得とキャッシュ

1. RSS/Atom/JSON Feed から 1 日単位で記事を収集できる。
2. 取得した記事は `.next/cache/enrich.json` に保存され、同一リビジョン内で再取得コストを抑える（将来的に永続ストアへ移行予定）。
3. キャッシュはコンテナ再起動時にクリアされることを前提とし、必要に応じて再生成できる仕組みを備える。
4. 手動/自動で要約キャッシュを再生成できる。

## 要件 3 ホスティングと配信

1. Next.js フロントエンド（要約 API を内包）は Cloud Run（単一コンテナ）で提供する。
2. ビルド済みコンテナは Artifact Registry（staging/prod）に保存し、Cloud Run へロールアウトできる。
3. カスタムドメインや HTTPS 設定は Cloud Run / Cloud Load Balancer を利用して管理する。

## 要件 4 運用・監視

1. Cloud Run のメトリクス／ログを利用し、日次で稼働状況を確認できる。
2. Firestore に保存されたキャッシュは一括削除や再生成が可能である。
3. GitHub Actions の実行ログからキャッシュウォーミングやデプロイ状況を確認できる。
4. コストは Cloud Billing レポートで把握し、無料枠内に収めることを意識する。

## 要件 5 自動処理

1. GitHub Actions の `Build and Push Container` で Docker イメージをビルドし、Artifact Registry（staging/prod）に push できる。
2. staging は `main` push で自動実行し、prod は `workflow_dispatch` で `confirm_prod=deploy` を指定する。
3. 自動デプロイは今後の追加項目とし、現状は手動で Cloud Run へロールアウトする。
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
3. アーキテクチャとデータフローは `docs/design/design.md` で最新の構成を示す。
4. 変更履歴は Git で追跡可能とし、重要な環境変更はドキュメントに反映する。
