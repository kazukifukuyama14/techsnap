# 運用ガイド

## 1. 運用方針

- 個人開発プロジェクトとして、可用性はベストエフォート。
- コストは Firebase 無料枠と API 利用料を中心に管理する。
- 重大な障害が発生した場合は Firebase コンソールと GitHub Actions のログを最初に確認する。

---

## 2. 日常チェックリスト（平日朝）

1. ブラウザで `https://techsnap-prod.web.app` を開き、一覧が表示されているか確認。
2. 最新の記事が表示されていない場合は、GitHub Actions の `Prefetch Feeds Cache` ワークフローが成功しているか確認。
3. Firebase コンソール > Firestore で `feedCache` コレクションを開き、更新日時が直近になっているか確認。

---

## 3. 週次チェックリスト

1. `npm outdated` / `npm audit` をローカルで実行し、依存関係の更新を検討。
2. GitHub Actions の履歴（失敗したワークフローや長時間実行）を確認。
3. OpenAI / DeepL の使用量をダッシュボードで確認し、上限に余裕があるかチェック。

---

## 4. 月次チェックリスト

1. Firebase コンソールで課金の概要を確認。
2. Firestore のバックアップが必要であれば、[バックアップ機能](https://firebase.google.com/docs/firestore/backups) を実行。
3. 運用ドキュメント (`docs/operation/operations.md`) が最新か見直し。

---

## 5. GitHub Actions（キャッシュウォーミング）

- ワークフロー名: **Prefetch Feeds Cache**
- スケジュール: 毎時 0 分に自動実行
- 手動実行手順:
  1. GitHub リポジトリの **Actions** タブを開く
  2. `Prefetch Feeds Cache` を選択
  3. `Run workflow` を押し、必要に応じて `force_refresh=true` を指定
- 失敗した場合はログを確認し、`FEED_CRON_ORIGIN` や API キーの環境変数が正しいか確認する。

---

## 6. Firestore キャッシュ運用

- キャッシュは `.next/cache/enrich.json`（ローカル）と Firestore `feedCache` / `feedAggregates` に保存される。
- 誤った要約があった場合は該当ドキュメントを削除し、GitHub Actions で `force_refresh=true` で再実行する。
- 長期間使わないデータは Firestore から削除してコストを抑える。

---

## 7. 既知のトラブルと対処

| 症状                                   | 対処                                                                              | 備考                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `scripts/fetch-feeds.mjs` で ENOTFOUND | `FEED_CRON_ORIGIN` が正しい URL か再確認（デプロイ済みの Hosting ドメインを指定） | ローカルで実行する場合は `firebase deploy` 後の URL を使用 |
| OpenAI API で rate-limit               | しばらく待機してから `force_refresh=true` で再実行                                | Plan の上限に注意                                          |
| Firestore 書き込みが失敗               | サービスアカウントのキーが有効期限切れの場合、再発行して Secrets を更新           | Firebase コンソールで確認                                  |

---

## 8. コミュニケーション・変更管理

- 重要な設定変更（API キーの更新、キャッシュ仕様の変更など）は GitHub の Pull Request でレビューし、ドキュメントを更新する。
- 障害や改修内容は Issue に記録しておくと後から追跡しやすい。

---

## 9. 参考リンク

- [Firebase Hosting 公式ドキュメント](https://firebase.google.com/docs/hosting)
- [Firestore ドキュメント](https://firebase.google.com/docs/firestore)
- [GitHub Actions ドキュメント](https://docs.github.com/actions)
