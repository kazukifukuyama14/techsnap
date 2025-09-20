# 構築手順書

## 1. 前提条件

### 必要なツール

- Node.js 18 以上
- npm
- Firebase CLI (`npm install -g firebase-tools`)
- Git

### 必要なアカウント

- Firebase プロジェクト（staging / production 推奨）
- GitHub アカウント（キャッシュウォーミング用ワークフローで使用）
- ChatGPT / DeepL など外部 API のキー

---

## 2. リポジトリ取得と依存関係

```bash
git clone https://github.com/your-account/techsnap.git
cd techsnap
npm install
```

---

## 3. Firebase プロジェクト設定

1. Firebase コンソールでステージング／本番のプロジェクトを作成し、Hosting と Firestore を有効化します。
2. 「プロジェクト設定 > サービスアカウント」から管理者用キー（JSON）を生成し、`secrets/firebase-admin-*.json` として保存します。
3. `apps/web/.env.local` を作成し、以下を参考に設定します。
   ```env
   FIREBASE_SERVICE_ACCOUNT_FILE=secrets/firebase-admin-staging.json
   OPENAI_API_KEY=...
   DEEPL_API_KEY=...
   FEED_CRON_ORIGIN=https://techsnap-staging.web.app
   ```
4. 本番用はデプロイ時に `firebase use techsnap-prod` で切り替え、必要に応じて `.env.production` を用意してください。

---

## 4. ローカル動作確認

```bash
# Firestore などの環境変数をロードして開発サーバーを起動
npm run dev
```

- ブラウザで `http://localhost:3000` にアクセスし、一覧表示と要約取得が動作するか確認します。
- API キーが未設定の場合はフォールバック表示（英語の excerpt）が出ることを確認してください。

---

## 5. Firebase Hosting デプロイ

1. Firebase CLI にログイン
   ```bash
   firebase login
   ```
2. プロジェクトを選択（初回のみ）
   ```bash
   firebase use --add  # プロンプトに従って staging / production を登録
   ```
3. ビルドとデプロイ
   ```bash
   npm run build --workspace apps/web
   firebase deploy --only hosting
   ```
4. ブラウザで `https://techsnap-staging.web.app`（または本番 URL）にアクセスし、プレースホルダーではなく Next.js アプリが表示されることを確認します。

---

## 6. GitHub Actions（キャッシュウォーミング）

1. リポジトリの **Settings > Secrets and variables > Actions** に以下を登録します。
   - `FIREBASE_SERVICE_ACCOUNT_FILE` を base64 化した文字列、または `FIREBASE_SERVICE_ACCOUNT` JSON
   - `OPENAI_API_KEY`, `DEEPL_API_KEY`（必要であれば）
2. `.github/workflows/prefetch-feeds.yml` は 1 時間ごとに `scripts/fetch-feeds.mjs` を実行し、staging / production の両サイトでキャッシュをウォームアップします。
3. 手動で実行する場合は GitHub の **Actions** タブから `Prefetch Feeds Cache` を選択し、`Run workflow` を押します。`force_refresh=true` を指定するとキャッシュを強制更新できます。

---

## 7. Firestore キャッシュのメンテナンス

- Firebase コンソールの Firestore 画面で `feedCache` / `feedAggregates` コレクションを確認できます。
- 古いキャッシュを削除したい場合は対象ドキュメントを削除し、GitHub Actions または手動で `scripts/fetch-feeds.mjs` を実行します。
- 定期的なバックアップが必要な場合は Firebase の「バックアップ」機能を利用してください。

---

## 8. トラブルシューティング

| 症状                      | 対応                                                                                                            | 備考                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 一覧が空になる            | Firebase Hosting でデプロイが成功しているか確認し、ブラウザのネットワークタブで `/api/feeds` のレスポンスを確認 | 環境変数（サービスアカウント）が未設定だと取得に失敗する場合があります |
| 要約が生成されない        | OpenAI/DeepL の API キーを確認し、`/api/enrich` のレスポンスを調査                                              | 失敗時は英語 excerpt にフォールバックします                            |
| GitHub Actions が失敗する | `Prefetch Feeds Cache` のログで `FEED_CRON_ORIGIN` や API キーが設定されているか確認                            | ワークフローは `node scripts/fetch-feeds.mjs` を実行します             |

---

これで Firebase Hosting を利用した TechSnap のセットアップとデプロイが完了します。 staging / production の切り替えは `firebase use` で行い、それぞれの環境に対して `firebase deploy --only hosting` を実行してください。
