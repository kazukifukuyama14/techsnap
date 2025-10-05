# Datastore スキーマ設計

## 方針

- 記事そのものを `Article` エンティティ、要約結果を `Summary` エンティティとして分離する。
- `Article` は URL を元にしたユニークキーを保持し、取得状況を `status` で管理する。
- `Summary` は `Article` のキーを外部キーとして参照し、英語・日本語の要約文と進捗ステータスを保持する。
- 進捗管理はポーリングおよびジョブ制御の両方で扱いやすいよう、`status` フィールドを冪等に更新する。
- タイムスタンプはすべて UTC ISO8601 文字列で保存し、必要に応じてクライアント側で変換する。

## エンティティ定義

### Article

| フィールド            | 型       | 必須 | 説明                                                                     |
| --------------------- | -------- | ---- | ------------------------------------------------------------------------ |
| `url`                 | string   | ✅   | 記事 URL。ハッシュ化してキー名に利用する。                               |
| `title`               | string   | ✅   | 記事タイトル（取得時のスナップショット）。                               |
| `rawBody`             | text     | ✅   | HTML/Markdown など生の本文。                                             |
| `status`              | string   | ✅   | `PENDING_FETCH` / `FETCHED` / `FAILED` / `SUMMARIZED` などの進捗を表す。 |
| `sourceId`            | string   | ✅   | RSS フィードや媒体ごとの識別子。                                         |
| `publishedAt`         | datetime | ✅   | 記事の公開日時。Timezone は UTC 換算。                                   |
| `fetchedAt`           | datetime | ✅   | RSS から取得した日時。                                                   |
| `createdAt`           | datetime | ✅   | エンティティ作成日時。                                                   |
| `updatedAt`           | datetime | ✅   | 最終更新日時。ステータス更新ごとに変更する。                             |
| `failureReason`       | string   | ❌   | 失敗時のエラーメッセージ。                                               |
| `summaryAttemptCount` | integer  | ❌   | 要約実行の試行回数。リトライ制御に利用。                                 |

### Summary

| フィールド   | 型       | 必須 | 説明                                                        |
| ------------ | -------- | ---- | ----------------------------------------------------------- |
| `articleKey` | key      | ✅   | 紐付く `Article` の Datastore Key（親参照）。               |
| `status`     | string   | ✅   | `QUEUED` / `IN_PROGRESS` / `SUMMARIZED` / `FAILED` を想定。 |
| `summaryEn`  | text     | ✅   | 英語要約。                                                  |
| `summaryJa`  | text     | ✅   | 日本語要約。DeepL で生成。                                  |
| `tokensUsed` | integer  | ❌   | OpenAI / DeepL それぞれのトークン・文字数合計。             |
| `costUsd`    | double   | ❌   | 推定コスト。ジョブ監視に利用。                              |
| `createdAt`  | datetime | ✅   | エンティティ作成日時。                                      |
| `updatedAt`  | datetime | ✅   | 最終更新日時。                                              |
| `lastError`  | string   | ❌   | 失敗時のエラーメッセージ。                                  |

> `Summary` は `Article` の子エンティティとして登録しても良いが、トラフィック分離と権限制御の柔軟性を優先し別 Kind とする。

## ステータス遷移

### Article.status

```
PENDING_FETCH -> FETCHED -> (SUMMARIZED | FAILED)
                                ^
                                └── RSS 更新時に再キューイングする場合は PENDING_FETCH へ戻す
```

### Summary.status

```
QUEUED -> IN_PROGRESS -> SUMMARIZED
                      └-> FAILED (失敗時は再実行で QUEUED に戻す)
```

## インデックス設計

Datastore は単一プロパティのインデックスを自動で作成するため、複合条件で利用するクエリのみ `index.yaml` に定義する。

| 用途                       | Kind      | フィルタ                | ソート             | 備考                                         |
| -------------------------- | --------- | ----------------------- | ------------------ | -------------------------------------------- |
| 要約対象記事の取得         | `Article` | `status = "FETCHED"`    | `updatedAt DESC`   | 要約ジョブが新しい記事から処理するため。     |
| フィード単位の最新記事表示 | `Article` | `sourceId = <feed>`     | `publishedAt DESC` | 管理画面で媒体別の最新記事を確認。           |
| フロント用要約一覧         | `Summary` | `status = "SUMMARIZED"` | `updatedAt DESC`   | `/api/articles` が最新要約をページング取得。 |

## index.yaml への反映

`infra/datastore/index.yaml` に以下のような複合インデックスを定義する。

```yaml
indexes:
  - kind: Article
    properties:
      - name: status
      - name: updatedAt
        direction: desc
  - kind: Article
    properties:
      - name: sourceId
      - name: publishedAt
        direction: desc
  - kind: Summary
    properties:
      - name: status
      - name: updatedAt
        direction: desc
```

適用コマンド例:

```bash
gcloud config set project <PROJECT_ID>
gcloud datastore indexes create infra/datastore/index.yaml
```

## 今後の課題

- 複数条件での全文検索やタグ検索が必要な場合は、Algolia / Firestore フルテキスト検索など外部サービスの導入を検討する。
- `Summary` の冪等性を確保するため、処理開始前にステータスと `updatedAt` を compare-and-set する実装が必要。
- BigQuery 連携やバックアップに備えて、日次で Datastore → GCS のエクスポートジョブを scheduler 化する予定。

```

```

## Datastore クライアント PoC

- 実装場所: `apps/web/src/lib/datastore/index.ts`
- 動作確認スクリプト: `apps/web/src/scripts/datastore/poc.ts`

実行例:

```bash
# プロジェクト ID を環境変数で指定
export GCP_PROJECT_ID=techsnap-staging

# 依存パッケージをインストール
npm --workspace apps/web install

# ts-node や tsx がローカルにある場合
npx tsx apps/web/src/scripts/datastore/poc.ts
```

> 初回実行時に `@google-cloud/datastore` への認証に必要なサービスアカウントが設定されていることを確認してください。
