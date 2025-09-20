# 運用ガイド（Cloud Run 構成）

## 1. 体制

- 運用責任者: 個人開発者
- 運用時間: ベストエフォート
- 主な利用サービス: Cloud Run / Artifact Registry / Firestore / Secret Manager / GitHub Actions

## 2. 日次チェック

1. Cloud Run（staging / production）のリビジョンとトラフィックを確認。
2. Cloud Logging で `severity>=ERROR` を検索し、要約 API の失敗がないか確認。
3. Firestore の `feedCache` / `feedAggregates` コレクションで更新日時を確認。

## 3. 週次チェック

1. `npm outdated` / `npm audit` をローカルで実行し、依存関係を棚卸し。
2. GitHub Actions の履歴を確認し、失敗しているワークフローがないかをチェック。
3. Cloud Monitoring のダッシュボードでレイテンシ・CPU/メモリ使用量を確認。
4. Artifact Registry の古いイメージが自動削除されているか確認。

## 4. 月次チェック

1. Cloud Billing でコストレポートを確認。
2. Firestore バックアップ（必要に応じて）を実施。
3. Cloud Run サービスアカウントや Secret Manager のローテーションが必要か見直す。

## 5. GitHub Actions

- キャッシュウォーミング: `Prefetch Feeds Cache` ワークフローで 1 時間毎に実行。必要に応じて `force_refresh=true` で手動実行。
- デプロイ用ワークフロー（任意）: `frontend` `api` の Docker イメージをビルドし、`gcloud run deploy` を実行する。

## 6. Firestore キャッシュ運用

- 誤った要約があれば該当ドキュメントを削除し、GitHub Actions を `force_refresh=true` で再実行。
- 長期的に不要なデータは削除して保存料金を抑える。

## 7. 障害対応

1. Cloud Logging / Monitoring で影響範囲を確認。
2. Cloud Run の以前のリビジョンへロールバック（Cloud Console または `gcloud run services update-traffic`）。
3. Firestore のバックアップから復旧が必要な場合は `gcloud firestore import` / `export` を使用。
4. 原因分析が終わったら GitHub Issues / ドキュメントに記録。

## 8. 手動デプロイ手順（参考）

```bash
# フロント
REGION=asia-northeast1
PROJECT=techsnap-staging
REPO=techsnap-web

gcloud builds submit apps/web \
  --tag $REGION-docker.pkg.dev/$PROJECT/$REPO/frontend:manual

gcloud run deploy techsnap-frontend \
  --image $REGION-docker.pkg.dev/$PROJECT/$REPO/frontend:manual \
  --region $REGION \
  --allow-unauthenticated
```

バックエンドも同様に `apps/api` を対象に実行する。

## 9. 参考リンク

- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Artifact Registry ドキュメント](https://cloud.google.com/artifact-registry/docs)
- [Firestore ドキュメント](https://cloud.google.com/firestore/docs)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)
