# 運用設計書

## 概要

技術記事要約サービス「TechSnap」の日常運用、監視、保守に関する手順とガイドラインを記載します。

## 1. 運用体制

### 1.1 運用責任者

- **システム管理者**: 個人開発者（あなた）
- **運用時間**: 24 時間 365 日（ベストエフォート）
- **対応レベル**: 個人利用のため、緊急対応は平日日中を基本とする

### 1.2 運用方針

- **可用性目標**: 99%（月間約 7 時間のダウンタイム許容）
- **復旧目標時間（RTO）**: 4 時間以内
- **復旧ポイント目標（RPO）**: 24 時間以内
- **コスト優先**: 無料枠を最大限活用し、コストを最小限に抑制

## 2. 日常運用手順

### 2.1 日次確認項目（平日朝）

```bash
# 1. サービス稼働状況確認
curl -f https://your-domain.com/api/health || echo "サービス異常"

# 2. Cloud Runサービス状況確認
gcloud run services list --platform=managed --format="table(metadata.name,status.url,status.conditions[0].type)"

# 3. Firestoreデータベース状況確認
gcloud firestore databases list

# 4. エラーログ確認（過去24時間）
gcloud logging read "severity>=ERROR" --freshness=1d --limit=10

# 5. コスト確認
gcloud billing budgets list
```

### 2.2 週次確認項目（毎週月曜日）

```bash
# 1. セキュリティアップデート確認
npm audit

# 2. 依存関係更新確認
npm outdated

# 3. バックアップ状況確認
gsutil ls gs://techsnap-backups/

# 4. パフォーマンスメトリクス確認
gcloud monitoring metrics list --filter="metric.type:run.googleapis.com"

# 5. 使用量レポート確認
gcloud logging read "resource.type=cloud_run_revision" --freshness=7d | grep -c "request"
```

### 2.3 月次確認項目（毎月 1 日）

```bash
# 1. 月間コスト確認
gcloud billing accounts list
gcloud billing projects describe PROJECT_ID

# 2. セキュリティ監査
gcloud asset search-all-iam-policies --scope=projects/PROJECT_ID

# 3. 不要リソース削除
gcloud compute images list --filter="creationTimestamp<-P30D"

# 4. バックアップ整理
gsutil ls -l gs://techsnap-backups/ | awk '$1 < systime()-2592000'

# 5. パフォーマンス分析レポート作成
```

## 3. 監視・アラート設定

### 3.1 Google Cloud Monitoring 設定

#### 3.1.1 アップタイムチェック

```yaml
# uptime-check.yaml
displayName: "TechSnapアップタイムチェック"
monitoredResource:
  type: "uptime_url"
  labels:
    project_id: "techsnap-prod"
    host: "your-domain.com"
httpCheck:
  path: "/api/health"
  port: 443
  useSsl: true
period: "300s"
timeout: "10s"
```

#### 3.1.2 エラー率アラート

```yaml
# error-rate-alert.yaml
displayName: "高エラー率アラート"
conditions:
  - displayName: "エラー率が5%を超過"
    conditionThreshold:
      filter: 'resource.type="cloud_run_revision"'
      comparison: COMPARISON_GREATER_THAN
      thresholdValue: 0.05
      duration: "300s"
alertPolicy:
  notificationChannels:
    - "projects/PROJECT_ID/notificationChannels/EMAIL_CHANNEL_ID"
```

#### 3.1.3 レスポンス時間アラート

```yaml
# response-time-alert.yaml
displayName: "レスポンス時間アラート"
conditions:
  - displayName: "平均レスポンス時間が1秒を超過"
    conditionThreshold:
      filter: 'resource.type="cloud_run_revision" metric.type="run.googleapis.com/request_latencies"'
      comparison: COMPARISON_GREATER_THAN
      thresholdValue: 1000
      duration: "300s"
```

### 3.2 通知設定

```bash
# メール通知チャンネル作成
gcloud alpha monitoring channels create \
  --display-name="運用者メール通知" \
  --type=email \
  --channel-labels=email_address=your-email@example.com

# Slack通知チャンネル作成（オプション）
gcloud alpha monitoring channels create \
  --display-name="Slack通知" \
  --type=slack \
  --channel-labels=url=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### 3.3 ダッシュボード設定

```json
{
  "displayName": "TechSnap運用ダッシュボード",
  "mosaicLayout": {
    "tiles": [
      {
        "width": 6,
        "height": 4,
        "widget": {
          "title": "リクエスト数",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\"",
                    "aggregation": {
                      "alignmentPeriod": "300s",
                      "perSeriesAligner": "ALIGN_RATE"
                    }
                  }
                }
              }
            ]
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "widget": {
          "title": "エラー率",
          "xyChart": {
            "dataSets": [
              {
                "timeSeriesQuery": {
                  "timeSeriesFilter": {
                    "filter": "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_count\"",
                    "aggregation": {
                      "alignmentPeriod": "300s",
                      "perSeriesAligner": "ALIGN_RATE"
                    }
                  }
                }
              }
            ]
          }
        }
      }
    ]
  }
}
```

## 4. バックアップ・復旧手順

### 4.1 Firestore バックアップ

#### 4.1.1 自動バックアップ設定

```bash
# 日次バックアップスケジュール作成
gcloud firestore backups schedules create \
  --database="(default)" \
  --recurrence=daily \
  --retention=7d \
  --backup-delete-lock=false
```

#### 4.1.2 手動バックアップ

```bash
# 手動バックアップ実行
gcloud firestore export gs://techsnap-backups/manual-backup-$(date +%Y%m%d-%H%M%S)

# バックアップ状況確認
gcloud firestore operations list
```

### 4.2 設定ファイルバックアップ

```bash
# Terraform設定バックアップ
gsutil -m cp -r terraform/ gs://techsnap-backups/terraform-backup-$(date +%Y%m%d)/

# 環境変数ファイルバックアップ
gsutil cp .env.production gs://techsnap-backups/env-backup-$(date +%Y%m%d)/
```

### 4.3 復旧手順

#### 4.3.1 Firestore 復旧

```bash
# 1. 復旧ポイント確認
gsutil ls gs://techsnap-backups/

# 2. データベース復旧
gcloud firestore import gs://techsnap-backups/BACKUP_FOLDER/

# 3. 復旧確認
gcloud firestore databases describe --database="(default)"
```

#### 4.3.2 アプリケーション復旧

```bash
# 1. 前回正常バージョンにロールバック
gcloud run services update techsnap \
  --image=gcr.io/PROJECT_ID/techsnap:PREVIOUS_TAG \
  --platform=managed

# 2. サービス確認
curl -f https://your-domain.com/api/health

# 3. ログ確認
gcloud logging read "resource.type=cloud_run_revision" --limit=10
```

## 5. セキュリティ運用

### 5.1 定期セキュリティチェック

```bash
# 1. 脆弱性スキャン
npm audit --audit-level=moderate

# 2. 依存関係更新
npm update

# 3. セキュリティパッチ適用
gcloud components update

# 4. IAM権限監査
gcloud projects get-iam-policy PROJECT_ID --format=json > iam-audit-$(date +%Y%m%d).json
```

### 5.2 アクセスログ監視

```bash
# 不審なアクセスパターン検出
gcloud logging read '
  resource.type="cloud_run_revision"
  AND (httpRequest.status>=400 OR httpRequest.userAgent=~"bot|crawler|scanner")
' --freshness=1d

# 大量リクエスト検出
gcloud logging read '
  resource.type="cloud_run_revision"
' --freshness=1h | grep -c "httpRequest" | awk '$1 > 1000 {print "大量リクエスト検出: " $1}'
```

### 5.3 シークレット管理

```bash
# 1. シークレット一覧確認
gcloud secrets list

# 2. シークレット更新
echo "new-secret-value" | gcloud secrets versions add SECRET_NAME --data-file=-

# 3. 古いバージョン削除
gcloud secrets versions destroy VERSION_ID --secret=SECRET_NAME
```

## 6. パフォーマンス管理

### 6.1 パフォーマンス監視

```bash
# 1. レスポンス時間分析
gcloud logging read '
  resource.type="cloud_run_revision"
  AND httpRequest.latency>"1s"
' --freshness=1d --format="value(httpRequest.requestUrl,httpRequest.latency)"

# 2. メモリ使用量確認
gcloud monitoring metrics list --filter="metric.type:run.googleapis.com/container/memory/utilizations"

# 3. CPU使用量確認
gcloud monitoring metrics list --filter="metric.type:run.googleapis.com/container/cpu/utilizations"
```

### 6.2 パフォーマンス最適化

```bash
# 1. 不要なログ削除
gcloud logging sinks create cleanup-sink \
  bigquery.googleapis.com/projects/PROJECT_ID/datasets/logs \
  --log-filter='severity<ERROR'

# 2. キャッシュ効率確認
gcloud logging read 'resource.type="cloud_run_revision" AND "cache-hit"' --freshness=1d

# 3. データベースクエリ最適化確認
# Firestoreコンソールでクエリパフォーマンス確認
```

## 7. コスト管理

### 7.1 コスト監視

```bash
# 1. 月間コスト確認
gcloud billing accounts list
gcloud billing projects describe PROJECT_ID

# 2. サービス別コスト分析
gcloud billing budgets list --billing-account=BILLING_ACCOUNT_ID

# 3. 予算アラート設定
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="月間予算アラート" \
  --budget-amount=50USD \
  --threshold-percent=80,100
```

### 7.2 コスト最適化

```bash
# 1. 不要リソース削除
gcloud compute images list --filter="creationTimestamp<-P30D" --format="value(name)" | \
  xargs -I {} gcloud compute images delete {} --quiet

# 2. ログ保持期間最適化
gcloud logging sinks update _Default \
  --log-filter='severity>=WARNING' \
  --destination=storage.googleapis.com/BUCKET_NAME

# 3. Cloud Run最小インスタンス調整
gcloud run services update techsnap \
  --min-instances=0 \
  --platform=managed
```

## 8. 障害対応手順

### 8.1 障害レベル定義

| レベル | 定義               | 対応時間    | 対応方法           |
| ------ | ------------------ | ----------- | ------------------ |
| P1     | サービス完全停止   | 1 時間以内  | 即座に対応開始     |
| P2     | 機能の一部停止     | 4 時間以内  | 営業時間内対応     |
| P3     | パフォーマンス劣化 | 24 時間以内 | 計画的対応         |
| P4     | 軽微な不具合       | 1 週間以内  | 次回メンテナンス時 |

### 8.2 障害対応フロー

```bash
# 1. 障害検知・確認
curl -f https://your-domain.com/api/health
gcloud run services describe techsnap --platform=managed

# 2. 影響範囲調査
gcloud logging read "severity>=ERROR" --freshness=1h --limit=50

# 3. 緊急対応（必要に応じて）
# ロールバック
gcloud run services update techsnap \
  --image=gcr.io/PROJECT_ID/techsnap:PREVIOUS_TAG \
  --platform=managed

# 4. 根本原因調査
gcloud logging read "resource.type=cloud_run_revision" --freshness=2h

# 5. 恒久対策実施
# コード修正・デプロイ

# 6. 事後報告書作成
```

### 8.3 エスカレーション

個人開発のため、外部エスカレーションは以下に限定：

1. **Google Cloud Support**（有料プラン契約時）
2. **Firebase Support**（Blaze プラン利用時）
3. **コミュニティフォーラム**（Stack Overflow、Reddit 等）

## 9. 定期メンテナンス

### 9.1 月次メンテナンス

```bash
# 第1土曜日 02:00-04:00（JST）実施

# 1. 依存関係更新
npm update
npm audit fix

# 2. セキュリティパッチ適用
gcloud components update

# 3. データベース最適化
# Firestoreインデックス最適化

# 4. ログローテーション
gcloud logging sinks create archive-sink \
  storage.googleapis.com/logs-archive-bucket

# 5. バックアップ整理
gsutil rm gs://techsnap-backups/**/*-$(date -d '3 months ago' +%Y%m)*
```

### 9.2 四半期メンテナンス

```bash
# 1. セキュリティ監査
gcloud asset search-all-iam-policies --scope=projects/PROJECT_ID

# 2. パフォーマンス分析
# 3ヶ月間のメトリクス分析・レポート作成

# 3. 災害復旧テスト
# バックアップからの復旧テスト実施

# 4. 運用手順見直し
# 本ドキュメントの更新
```

## 10. 運用ツール・スクリプト

### 10.1 ヘルスチェックスクリプト

```bash
#!/bin/bash
# health-check.sh

echo "=== TechSnap ヘルスチェック ==="
echo "実行時刻: $(date)"

# サービス稼働確認
if curl -f -s https://your-domain.com/api/health > /dev/null; then
    echo "✅ サービス: 正常"
else
    echo "❌ サービス: 異常"
    exit 1
fi

# データベース確認
if gcloud firestore databases describe --database="(default)" > /dev/null 2>&1; then
    echo "✅ データベース: 正常"
else
    echo "❌ データベース: 異常"
fi

# エラーログ確認
ERROR_COUNT=$(gcloud logging read "severity>=ERROR" --freshness=1h --format="value(timestamp)" | wc -l)
if [ $ERROR_COUNT -lt 5 ]; then
    echo "✅ エラーログ: 正常 ($ERROR_COUNT件)"
else
    echo "⚠️ エラーログ: 要確認 ($ERROR_COUNT件)"
fi

echo "=== チェック完了 ==="
```

### 10.2 バックアップスクリプト

```bash
#!/bin/bash
# backup.sh

BACKUP_DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_BUCKET="gs://techsnap-backups"

echo "=== バックアップ開始: $BACKUP_DATE ==="

# Firestoreバックアップ
echo "Firestoreバックアップ中..."
gcloud firestore export $BACKUP_BUCKET/firestore-$BACKUP_DATE

# 設定ファイルバックアップ
echo "設定ファイルバックアップ中..."
gsutil -m cp -r terraform/ $BACKUP_BUCKET/terraform-$BACKUP_DATE/

echo "=== バックアップ完了 ==="
```

### 10.3 コスト確認スクリプト

```bash
#!/bin/bash
# cost-check.sh

echo "=== 月間コスト確認 ==="

# 現在の課金情報取得
gcloud billing accounts list --format="table(name,displayName,open)"

# プロジェクト別コスト（概算）
echo "プロジェクト別リソース使用量:"
gcloud compute instances list --format="table(name,zone,machineType,status)"
gcloud run services list --format="table(metadata.name,status.url,spec.template.spec.containers[0].resources.limits.cpu)"

echo "=== 確認完了 ==="
```

## 11. 緊急連絡先・参考資料

### 11.1 緊急時参考資料

- **Google Cloud Status**: <https://status.cloud.google.com/>
- **Firebase Status**: <https://status.firebase.google.com/>
- **Next.js Documentation**: <https://nextjs.org/docs>
- **Terraform Documentation**: <https://registry.terraform.io/providers/hashicorp/google/latest/docs>

### 11.2 運用ログ

運用作業は以下の形式で記録：

```text
日時: 2024-01-15 10:30
作業者: 運用者名
作業内容: 月次メンテナンス実施
結果: 正常完了
備考: 依存関係3件更新、セキュリティパッチ適用
```

この運用設計書は定期的に見直し、実際の運用状況に合わせて更新してください。
