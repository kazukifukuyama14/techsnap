# セキュリティ設計書

## 1. 基本方針

- **最小権限**: Firebase コンソールで Hosting / Firestore / Secrets の権限を用途ごとに分離する。
- **機密情報の厳格管理**: サービスアカウントや API キーは `.env` と GitHub Secrets のみに保存し、リポジトリへコミットしない。
- **通信の保護**: すべて HTTPS。Firebase Hosting 配信のため証明書は自動管理される。
- **可視化と監査**: Git 履歴・GitHub Actions ログ・Firebase コンソールの履歴を参照し、設定変更を追跡する。

## 2. 認証・認可

- 外部ユーザー向け認証は現状不要だが、将来的に Firebase Authentication を導入する場合はメールアドレスや Google ログインを想定。
- Firestore への書き込みはサーバーサイド（Admin SDK）専用。クライアントからの書き込みは許可しない。
- Firestore Security Rules 例:
  ```javascript
  service cloud.firestore {
    match /databases/{database}/documents {
      match /feedCache/{source}/snapshots/{date} {
        allow read: if true;       // 公開情報
        allow write: if false;     // Admin SDK のみ
      }
      match /feedAggregates/{group}/snapshots/{date} {
        allow read: if true;
        allow write: if false;
      }
    }
  }
  ```

## 3. 外部 API の利用

| API    | 保護すべき情報   | 保存場所                      | 備考                      |
| ------ | ---------------- | ----------------------------- | ------------------------- |
| OpenAI | `OPENAI_API_KEY` | `.env.local` / GitHub Secrets | レート制限と課金に注意    |
| DeepL  | `DEEPL_API_KEY`  | `.env.local` / GitHub Secrets | Free/Pro どちらでも使用可 |

## 4. サービスアカウント運用

- Firebase Admin SDK 用 JSON は `secrets/` ディレクトリに配置し、`.gitignore` 済み。
- 本番・ステージングでファイルを分け、GitHub Secrets には Base64 で登録する。
- キーが漏洩した場合は Firebase コンソールから「キーの無効化・再発行」を行い、新しい値で Secrets を更新する。

## 5. ログと監視

- Firebase コンソールの **Hosting > ログ** や **Firestore > 使用状況** を確認する。
- GitHub Actions のログでキャッシュウォーミングの成功/失敗を監視する。
- 重大なエラーは GitHub Issues に記録し、再発防止策を検討する。

## 6. インシデント対応テンプレート

1. 影響範囲の把握（サイトの稼働状況、Firestore データの破損有無）。
2. 原因調査（GitHub Actions ログ、Firebase コンソールの履歴、アプリログなど）。
3. 応急処置（キャッシュの削除・再生成、API キーの無効化など）。
4. 復旧確認（サイトが 200 を返すか、一覧が表示されるかを手動確認）。
5. 再発防止（ドキュメント更新、手順の見直し、チェックリスト追記）。

## 7. ベストプラクティス

- 依存関係は定期的に `npm audit` / `npm outdated` で確認し、脆弱性を放置しない。
- API キーは用途ごとに分け、不要になったキーは無効化する。
- Firestore への直接アクセスは避け、必要ならば Read Only のサービスアカウントを発行する。
- 機密設定の変更は Pull Request でレビューし、どの値をいつ更新したか把握できるようにする。
