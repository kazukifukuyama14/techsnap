# セキュリティ設計書

## 1. 基本方針

- 最小権限: Cloud Run と関連サービスアカウントには必要最小限のロールのみ付与する。
- シークレット管理: OPENAI / DeepL などのキーは Secret Manager または GitHub Secrets から注入し、リポジトリには含めない。
- 通信暗号化: すべての通信は HTTPS 経由。Cloud Run のカスタムドメイン設定時も TLS を有効化する。
- 監査: Cloud Logging / Cloud Audit Logs を活用し、権限変更や API エラーを追跡する。

## 2. 認証・認可

- フロント Cloud Run サービス: 公開（`--allow-unauthenticated`）。必要に応じて Identity-Aware Proxy で保護する。
- API Cloud Run サービス: 原則として外部公開を最小限にし、Identity Token を利用してフロントからのみ呼び出せるように構成可能。
- Firestore: Admin SDK を利用するサービスアカウントに `roles/datastore.user` 相当の権限を付与し、他の権限は付けない。

## 3. シークレットと環境変数

- Cloud Run の `--set-env-vars` では秘匿情報を直接設定せず、`--set-secrets` + Secret Manager を推奨。
- GitHub Actions からデプロイする場合は、必要なサービスアカウントキーを GitHub Secrets (`GCP_SA_KEY` など) に保存し、workflow 内で `gcloud auth activate-service-account` を実行する。

## 4. 外部 API

| API    | 保護する情報     | 管理方法                            |
| ------ | ---------------- | ----------------------------------- |
| OpenAI | `OPENAI_API_KEY` | Secret Manager + Cloud Run 環境変数 |
| DeepL  | `DEEPL_API_KEY`  | Secret Manager + Cloud Run 環境変数 |

## 5. Cloud Run セキュリティ設定

- サービスアカウントを専用に作成し、Firestone など必要な権限のみ付与する。
- 余計なトラフィックを避けるために最小インスタンス数を 0 とし、必要なら最大インスタンス数を制限する。
- ログに機密情報を出力しないよう、エラーメッセージをマスクする。

## 6. Firestore Rules

キャッシュ用途で読み取り公開が許容されるかを検討し、必要に応じて匿名読み込み可に設定する。書き込みは Cloud Run サービスアカウントのみが行う。

## 7. 運用時の注意

- Cloud Run の新リビジョンで異常が発生した場合に備え、ロールバック手順を用意する。
- Artifact Registry に古いイメージが残り続けてコストが発生しないよう、クリーンアップポリシーを設定する。
- Cloud Monitoring / Alerting でエラー率・レスポンスタイムを監視し、閾値超過時に通知を受け取る。
