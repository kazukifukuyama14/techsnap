# 実装計画

- [ ] 1. セットアップ

  - Firebase プロジェクト（staging / production）を作成し、Hosting・Firestore を有効化
  - サービスアカウント JSON を取得して `.env.local` / GitHub Secrets に設定
  - `npm install` で依存関係をインストール

- [ ] 2. データ取得基盤

  - RSS/Atom/JSON Feed からの取得ロジックを整備し、404/未対応形式のフォールバックを実装
  - Firestore に日次スナップショットを保存するキャッシュ層を実装
  - 要約 API 向けのデータ整形（タイトル、excerpt、URL）を用意

- [ ] 3. 要約・翻訳機能

  - OpenAI API で 1 文要約を生成
  - DeepL API で日本語翻訳を実施（フォールバックを含む）
  - 生成結果を Firestore キャッシュへ永続化し、一覧表示で利用

- [ ] 4. フロントエンド

  - 一覧画面（グループ／ソース別フィルタ、日付ごとセクション化）
  - 記事カード（タイトル、要約、タグ、日時、外部リンク）
  - ローディング・エラーハンドリング・無限スクロール／もっと見る機能

- [ ] 5. 自動処理と運用

  - `scripts/fetch-feeds.mjs` を整備し、Firebase Hosting の URL を指定してキャッシュウォーミング
  - GitHub Actions (`prefetch-feeds.yml`) を設定し、1 時間ごと＆手動トリガーでスクリプトを実行
  - Firestore キャッシュの監視・バックアップ手順をドキュメント化

- [ ] 6. デプロイフロー

  - `firebase init hosting` の設定整理（staging / production サイト）
  - `firebase deploy --only hosting` の手順確認とデプロイチェックリスト作成
  - 失敗時のロールバック方法（前回デプロイへの切り戻し）をまとめる

- [ ] 7. 品質保証

  - RSS 取得・要約生成・Firestore 保存のユニットテスト
  - fetch/enrich API の統合テスト（Mock 使用）
  - UI のスナップショットまたは Playwright による簡易 E2E

- [ ] 8. ドキュメント整備

  - セットアップ／運用手順を README と `docs/requirements/setup.md` に反映
  - キャッシュ運用と GitHub Actions の手順を `docs/operation/operations.md` に記載
  - アーキテクチャ図・データフローを更新
