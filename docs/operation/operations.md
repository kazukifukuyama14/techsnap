# 運用ガイド（Cloud Run 構成）

## 1. 体制

- 運用責任者: 個人開発者
- 運用時間: ベストエフォート
- 主な利用サービス: Cloud Run / Artifact Registry / Secret Manager / GitHub Actions

## 2. 日次チェック

1. Cloud Run（staging / production）のリビジョンとトラフィックを確認。
2. Cloud Logging で `severity>=ERROR` を検索し、`/api/enrich` の失敗がないか確認。
3. Artifact Registry の最新イメージが staging / prod 双方で生成されているか確認。

## 3. 週次チェック

1. `npm outdated` / `npm audit` をローカルで実行し、依存関係を棚卸し。
2. GitHub Actions の履歴を確認し、`Build and Push Container` の失敗がないかチェック。
3. Cloud Monitoring のダッシュボードでレイテンシ・CPU/メモリ使用量を確認。
4. Artifact Registry のクリーンアップポリシーが意図通り動作しているか確認。

## 4. 月次チェック

1. Cloud Billing でコストレポートを確認。
2. コンテナ内部キャッシュ（`.next/cache/enrich.json`）の扱い方針を見直す。
3. Cloud Run サービスアカウントや Secret Manager のローテーションが必要か見直す。

## 5. GitHub Actions

- `Build and Push Container`: staging / prod 向けに Docker イメージをビルドし Artifact Registry へ push。staging は `main` push で自動、prod は `workflow_dispatch` で `target_environment=prod`, `confirm_prod=deploy` を指定して実行する。
- 今後、Cloud Run へのロールアウトを自動化する追加ワークフローを検討する。

## 6. 要約キャッシュ運用

- 誤った要約があれば `.next/cache/enrich.json` を削除し、再度 `/api/enrich` を叩いて再生成（コンテナ再起動でもキャッシュはクリア）。
- 永続的なキャッシュを導入する場合は Firestore / Memorystore 等を検討。

## 7. 障害対応

1. Cloud Logging / Monitoring で影響範囲を確認。
2. Cloud Run の以前のリビジョンへロールバック（Cloud Console または `gcloud run services update-traffic`）。
3. OpenAI / DeepL のステータスや API キー有効期限を確認し、問題があればフェールバック表示を検討。
4. 原因分析が終わったら GitHub Issues / ドキュメントに記録。

## 8. 手動デプロイ手順（参考）

```bash
REGION=asia-northeast1
PROJECT=techsnap-staging
REPO=techsnap-staging-repo

# 手動でビルドして Artifact Registry へ登録
gcloud builds submit apps/web \
  --tag $REGION-docker.pkg.dev/$PROJECT/$REPO/web:manual

# Cloud Run へデプロイ
gcloud run deploy techsnap-web \
  --image $REGION-docker.pkg.dev/$PROJECT/$REPO/web:manual \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated
```

## 9. 参考リンク

- [Cloud Run ドキュメント](https://cloud.google.com/run/docs)
- [Artifact Registry ドキュメント](https://cloud.google.com/artifact-registry/docs)
- [Secret Manager](https://cloud.google.com/secret-manager/docs)
- [GitHub Actions](https://docs.github.com/en/actions)
