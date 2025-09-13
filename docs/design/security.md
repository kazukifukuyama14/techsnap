# セキュリティ設計書

## 概要

技術記事要約サービス「TechSnap」のセキュリティ要件、脅威分析、対策、および運用セキュリティについて記載します。

## 1. セキュリティ方針

### 1.1 基本方針

- **最小権限の原則**: 必要最小限の権限のみ付与
- **多層防御**: 複数のセキュリティ対策を組み合わせ
- **ゼロトラスト**: 内部・外部を問わず全てのアクセスを検証
- **データ保護**: 個人情報・機密情報の適切な保護
- **透明性**: セキュリティ対策の可視化と監査

### 1.2 コンプライアンス

個人利用サービスのため、以下の基準を参考に設計：

- **OWASP Top 10**: Web アプリケーションセキュリティ
- **Google Cloud Security Best Practices**
- **Firebase Security Rules Best Practices**
- **個人情報保護法**（日本）

## 2. 脅威分析

### 2.1 脅威モデル

#### 2.1.1 外部脅威

| 脅威                 | 影響度 | 発生確率 | リスクレベル |
| -------------------- | ------ | -------- | ------------ |
| DDoS 攻撃            | 高     | 中       | 高           |
| SQL インジェクション | 高     | 低       | 中           |
| XSS 攻撃             | 中     | 中       | 中           |
| CSRF 攻撃            | 中     | 低       | 低           |
| 認証突破             | 高     | 低       | 中           |
| データ漏洩           | 高     | 低       | 中           |

#### 2.1.2 内部脅威

| 脅威     | 影響度 | 発生確率 | リスクレベル |
| -------- | ------ | -------- | ------------ |
| 設定ミス | 中     | 中       | 中           |
| 権限昇格 | 高     | 低       | 中           |
| 内部不正 | 低     | 低       | 低           |
| 人的ミス | 中     | 中       | 中           |

#### 2.1.3 技術的脅威

| 脅威             | 影響度 | 発生確率 | リスクレベル |
| ---------------- | ------ | -------- | ------------ |
| 脆弱性悪用       | 高     | 中       | 高           |
| 依存関係の脆弱性 | 中     | 高       | 高           |
| 設定不備         | 中     | 中       | 中           |
| ログ改ざん       | 低     | 低       | 低           |

## 3. 認証・認可設計

### 3.1 Firebase Authentication

#### 3.1.1 認証プロバイダー設定

```javascript
// firebase-auth-config.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  // 設定値は環境変数から取得
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Googleプロバイダー設定
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});
```

#### 3.1.2 認証フロー

```typescript
// auth-service.ts
interface AuthService {
  signInWithGoogle(): Promise<UserCredential>;
  signOut(): Promise<void>;
  getCurrentUser(): User | null;
  onAuthStateChanged(callback: (user: User | null) => void): Unsubscribe;
}

class FirebaseAuthService implements AuthService {
  async signInWithGoogle(): Promise<UserCredential> {
    try {
      const result = await signInWithPopup(auth, googleProvider);

      // ユーザー情報をFirestoreに保存
      await this.createUserProfile(result.user);

      return result;
    } catch (error) {
      console.error("認証エラー:", error);
      throw new AuthError("認証に失敗しました");
    }
  }

  private async createUserProfile(user: User): Promise<void> {
    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);

    if (!userDoc.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        preferences: {
          theme: "light",
          language: "ja",
          summaryStyle: "technical",
        },
      });
    } else {
      // 最終ログイン時刻更新
      await updateDoc(userRef, {
        lastLoginAt: serverTimestamp(),
      });
    }
  }
}
```

### 3.2 Firestore セキュリティルール

#### 3.2.1 基本ルール

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ユーザーコレクション
    match /users/{userId} {
      // 自分のプロフィールのみ読み書き可能
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // 作成時の検証
      allow create: if request.auth != null
        && request.auth.uid == userId
        && validateUserData(request.resource.data);
    }

    // 要約コレクション
    match /summaries/{summaryId} {
      // 自分の要約のみアクセス可能
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.userId;

      // 作成時の検証
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.userId
        && validateSummaryData(request.resource.data);
    }

    // キャッシュコレクション（読み取り専用）
    match /cache/{cacheId} {
      allow read: if request.auth != null;
      allow write: if false; // サーバーサイドのみ
    }

    // 管理者のみアクセス可能なコレクション
    match /admin/{document=**} {
      allow read, write: if request.auth != null
        && request.auth.token.admin == true;
    }
  }

  // バリデーション関数
  function validateUserData(data) {
    return data.keys().hasAll(['uid', 'email', 'createdAt'])
      && data.uid is string
      && data.email is string
      && data.email.matches('.*@.*\\..*');
  }

  function validateSummaryData(data) {
    return data.keys().hasAll(['userId', 'title', 'lUrl', 'summary', 'createdAt'])
      && data.userId is string
      && data.title is string
      && data.originalUrl is string
      && data.summary is string
      && data.originalUrl.matches('https?://.*');
  }
}
```

#### 3.2.2 セキュリティルールテスト

```javascript
// firestore-rules.test.js
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";

describe("Firestoreセキュリティルール", () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "test-project",
      firestore: {
        rules: fs.readFileSync("firestore.rules", "utf8"),
      },
    });
  });

  test("認証済みユーザーは自分のデータにアクセス可能", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const aliceDoc = alice.firestore().doc("users/alice");

    await assertSucceeds(
      aliceDoc.set({
        uid: "alice",
        email: "alice@example.com",
        createdAt: new Date(),
      })
    );

    await assertSucceeds(aliceDoc.get());
  });

  test("他のユーザーのデータにはアクセス不可", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const bobDoc = alice.firestore().doc("users/bob");

    await assertFails(bobDoc.get());
    await assertFails(bobDoc.set({ uid: "bob" }));
  });
});
```

## 4. データ保護

### 4.1 データ分類

| データ種別       | 機密レベル | 保護要件     | 保存場所      |
| ---------------- | ---------- | ------------ | ------------- |
| ユーザー認証情報 | 高         | 暗号化必須   | Firebase Auth |
| 個人設定         | 中         | アクセス制御 | Firestore     |
| 要約データ       | 中         | アクセス制御 | Firestore     |
| 記事キャッシュ   | 低         | 一般保護     | Firestore     |
| ログデータ       | 中         | 保持期間制限 | Cloud Logging |

### 4.2 暗号化

#### 4.2.1 保存時暗号化

```hcl
# terraform/google_firestore_main.tf
resource "google_firestore_database" "main" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # 保存時暗号化（Google管理キー）
  encryption_config {
    kms_key_name = google_kms_crypto_key.firestore_key.id
  }
}

# KMSキー作成
resource "google_kms_key_ring" "firestore_keyring" {
  name     = "firestore-keyring"
  location = var.region
}

resource "google_kms_crypto_key" "firestore_key" {
  name     = "firestore-key"
  key_ring = google_kms_key_ring.firestore_keyring.id

  lifecycle {
    prevent_destroy = true
  }
}
```

#### 4.2.2 転送時暗号化

```typescript
// api-client.ts
class SecureApiClient {
  private readonly baseURL: string;
  private readonly timeout: number = 30000;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(endpoint, this.baseURL);

    // HTTPS強制
    if (url.protocol !== "https:") {
      throw new Error("HTTPS接続が必要です");
    }

    const config: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...options.headers,
      },
      // セキュリティヘッダー
      credentials: "same-origin",
    };

    const response = await fetch(url.toString(), config);

    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.js();
  }
}
```

### 4.3 データ保持・削除

#### 4.3.1 データ保持ポリシー

```typescript
// data-retention.ts
interface DataRetentionPolicy {
  userProfiles: "無期限（ユーザー削除まで）";
  summaries: "無期限（ユーザー削除まで）";
  cache: "7日間";
  logs: "30日間";
  backups: "90日間";
}

class DataRetentionService {
  async cleanupExpiredData(): Promise<void> {
    // 期限切れキャッシュ削除
    await this.cleanupExpiredCache();

    // 古いログ削除
    await this.cleanupOldLogs();

    // 古いバックアップ削除
    await this.cleanupOldBackups();
  }

  private async cleanupExpiredCache(): Promise<void> {
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 7);

    const query = collection(db, "cache").where("expiresAt", "<", expiredDate);

    const snapshot = await getDocs(query);
    const batch = writeBatch(db);

    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
  }
}
```

#### 4.3.2 ユーザーデータ削除（GDPR 対応）

```typescript
// user-deletion.ts
class UserDeletionService {
  async deleteUserData(userId: string): Promise<void> {
    const batch = writeBatch(db);

    try {
      // ユーザープロフィール削除
      const userRef = doc(db, "users", userId);
      batch.delete(userRef);

      // ユーザーの要約データ削除
      const summariesQuery = collection(db, "summaries").where(
        "userId",
        "==",
        userId
      );
      const summariesSnapshot = await getDocs(summariesQuery);

      summariesSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      // Firebase Authからユーザー削除
      await admin.auth().deleteUser(userId);
      ole.log(`ユーザーデータ削除完了: ${userId}`);
    } catch (error) {
      console.error("ユーザーデータ削除エラー:", error);
      throw error;
    }
  }
}
```

## 5. ネットワークセキュリティ

### 5.1 Cloud Armor 設定

```hcl
# terraform/google_security_policy.tf
resource "google_compute_security_policy" "techsnap_policy" {
  name        = "techsnap-security-policy"
  description = "TechSnapセキュリティポリシー"

  # DDoS保護
  rule {
    action   = "deny(403)"
    priority = "1000"
    match {
      expr {
        expression = "origin.region_code == 'CN' || origin.region_code == 'RU'"
      }
    }
    description = "特定地域からのアクセス制限"
  }

  # レート制限
  rule {
    action   = "rate_based_ban"
    priority = "2000"
    match {
      expr {
        expression = "true"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 100
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
    description = "レート制限（100req/min）"
  }

  # SQLインジェクション対策
  rule {
    action   = "deny(403)"
    priority = "3000"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-stable')"
      }
    }
    description = "SQLインジェクション攻撃ブロック"
  }

  # XSS対策
  rule {
    action   = "deny(403)"
    priority = "4000"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-stable')"
      }
    }
    description = "XSS攻撃ブロック"
  }

  # デフォルト許可
  rule {
    action   = "allow"
    priority = "2147483647"
    match {
      expr {
        expression = "true"
      }
    }
    description = "デフォルト許可"
  }
}
```

### 5.2 VPC セキュリティ

```hcl
# terraform/google_vpc_security.tf
resource "google_compute_network" "vpc_network" {
  name                    = "techsnap-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "private_subnet" {
  name          = "private-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.vpc_network.id

  # プライベートGoogleアクセス有効化
  private_ip_google_access = true
}

# ファイアウォールルール
resource "google_compute_firewall" "allow_ht {
  name    = "allow-https"
  network = google_compute_network.vpc_network.name

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["https-server"]
}

resource "google_compute_firewall" "deny_all" {
  name    = "deny-all"
  network = google_compute_network.vpc_network.name

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
  priority      = 65534
}
```

## 6. アプリケーションセキュリティ

### 6.1 入力検証

```typescript
// input-validation.ts
import { z } from 'zod';

// URL検証スキーマ
const urlSchema = z.string()
  .url('有効なURLを入力してください')
  .refine(url => {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  }, 'HTTPまたはHTTPSのURLのみ許可されています')
  .refine(url => {
    const parsed = new URL(url);
    // 内部IPアドレスへのアクセス禁止
    const hostname = parsed.hostname;
    return !isPrivateIP(hostname);
  }, 'プライベートIPアドレスへのアクセスは禁止されています');

// 要約データ検証スキーマ
const summarySchema = z.object({
  title: z.string()
    .min(1, 'タイトルは必須です')
    .max(200, 'タイトルは200文字以内で入力してください')
    .refine(title => !containsXSS(title), 'XSS攻撃の可能性があります'),

  originalUrl: urlSchema,

  summary: z.string()10, '要約は10文字以上で入力してください')
    .max(5000, '要約は5000文字以内で入力してください')
    .refine(summary => !containsXSS(summary), 'XSS攻撃の可能性があります'),

  tags: z.array(z.string())
    .max(10, 'タグは10個まで設定できます')
    .refine(tags => tags.every(tag => tag.length <= 50), 'タグは50文字以内で入力してください')
});

function isPrivateIP(hostname: string): boolean {
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^localhost$/i
  ];

  return privateRanges.some(range => range.test(hostname));
}

function containsXSS(input: string): boolean {
  const xssPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i
  ];

  return xssPatterns.some(pattern => pattern.test(input));
}
```

### 6.2 CSRF 対策

```typescript
// csrf-protection.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getToken } from "next-auth/jwt";

export function withCSRFProtection(handler: Function) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // GET以外のリクエストでCSRFトークン検証
    if (req.method !== "GET") {
      const token = await getToken({ req });
      const csrfToken = req.headers["x-csrf-token"];
      if (!token || !csrfToken || token.csrfToken !== csrfToken) {
        return res.status(403).json({ error: "CSRF token mismatch" });
      }
    }

    return handler(req, res);
  };
}

// セキュリティヘッダー設定
export function setSecurityHeaders(res: NextApiResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Poliict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://apis.google.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https://api.openai.com https://*.googleapis.com"
  );
}
```

## 7. 監査・ログ

### 7.1 セキュリティログ

```typescript
// security-logger.ts
interface SecurityEvent {
  eventType: 'AUTH_SUCCESS' | 'AUTH_FAILURE' | 'PERMISSION_DENIED' | 'SUSPICIOUS_ACTIVITY';
  userId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  details: Record<string, any>;
}

class SecurityLogger {
  async logSecurityEvent(event: SecurityEvent): Promise<void> {
    const logEntry = {
      ...event,
      severity: this.getSeverity(event.eventType),
      source: 'techsnap'
    };

    // Cloud Loggingに送信
    console.log(JSON.stringify(logEntry));

    // 重要なイベントはFirestoreにも保存
    if (this.isCriticalEvent(event.eventType)) {
      await this.saveToFirestore(logEntry);
    }
  }

  private getSeverity(eventType: string): string {
    const severityMap = {
      'AUTH_SUCCESS': 'INFO',
      'AUTH_FAILURE': 'WARNING',
      'PERMISSION_DENIED': 'ERROR',
      'SUSPICIOUS_ACTIVITY': 'CRITICAL'
    };

    return severityMap[eventType] || 'INFO';
  }

  private isCriticalEvent(eventType: string): boolean {
    return ['PERMISSION_DENIED', 'SUSPICIOUS.includes(eventType);
  }
}
```

### 7.2 監査ログ分析

```bash
#!/bin/bash
# security-audit.sh

echo "=== セキュリティ監査レポート ==="
echo "実行日時: $(date)"

# 認証失敗の分析
echo "## 認証失敗分析"
gcloud logging read '
  jsonPayload.eventType="AUTH_FAILURE"
  AND timestamp>="2024-01-01T00:00:00Z"
' --format="value(jsonPayload.ipAddress)" | sort | uniq -c | sort -nr | head -10

# 権限拒否の分析
echo "## 権限拒否分析"
gcloud logging read '
  jsonPayload.eventType="PERMISSION_DENIED"
  AND timestamp>="2024-01-01T00:00:00Z"
' --format="value(jsonPayload.userId,jsonPayload.details)" | head -20

# 不審なアクティビティ
echo "## 不審なアクティビティ"
gcloud logging read '
  jsonPayload.eventType="SUSPICIOUS_ACTIVITY"
  AND timestamp>="2024-01-01T00:00:00Z"
' --format="table(timestamp,jsonPayload.ipAddress,jsonPayload.details)"

echo "=== 監査完了 ==="
```

## 8. インシデント対応

### 8.1 セキュリティインシデント分類

| レベル   | 定義                       | 対応時間    | 対応チーム          |
| -------- | -------------------------- | ----------- | ------------------- |
| Critical | データ漏洩、システム侵害   | 即座        | 開発者 + 外部専門家 |
| High     | 認証突破、権限昇格         | 1 時間以内  | 開発者              |
| Medium   | 脆弱性発見、不審なアクセス | 4 時間以内  | 開発者              |
| Low      | 設定不備、軽微な脆弱性     | 24 時間以内 | 開発者              |

### 8.2 インシデント対応手順

```bash
#!/bin/bash
# incident-response.sh

INCIDENT_TYPE=$1
SEVERITY=$2

echo "=== セキュリティインシデント対応開始 ==="
echo "インシデントタイプ: $INCIDENT_TYPE"
echo "重要度: $SEVERITY"
echo "開始時刻: $(date)"

case $SEVERITY in
  "CRITICAL")
    echo "緊急対応モード"
    # サービス停止
    gcloud run services update techsnap --traffic=0 --platform=managed

    # 緊急通知
    curl -X POST -H 'Content-type: application/json' \
'{"text":"🚨 CRITICAL: セキュリティインシデント発生"}' \
      $SLACK_WEBHOOK_URL
    ;;

  "HIGH")
    echo "高優先度対応"
    # 該当機能の無効化
    # 詳細調査開始
    ;;

  "MEDIUM"|"LOW")
    echo "通常対応"
    # ログ収集・分析
    ;;
esac

# 証拠保全
mkdir -p /tmp/incident-$(date +%Y%m%d-%H%M%S)
gcloud logging read "severity>=WARNING" --freshness=24h > /tmp/incident-$(date +%Y%m%d-%H%M%S)/logs.json

echo "=== 初期対応完了 ==="
```

## 9. 定期セキュリティ監査

### 9.1 自動セキュリティスキャン

```yaml
# .github/security-scan.yml
name: Security Scan
on:
  schedule:
    - cron: '0 2 * * 1'  # 毎週月曜日 2:00
  workflow_dispatch:

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run npm audit
        run: |
          npm audit --audit-level=moderate
          npm audit --json > security-audit.json
 - name: Run Snyk scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

      - name: Run CodeQL analysis
        uses: github/codeql-action/analyze@v2
        with:
          languages: javascript,typescript

      - name: Upload secreport
        uses: actions/upload-artifact@v3
        with:
          name: security-report
          path: security-audit.json
```

### 9.2 手動セキュリティチェック

```bash
#!/bin/bash
# manual-security-check.sh

echo "=== 手動セキュリティチェック ==="

# 1. IAM権限監査
echo "## IAM権限監査"
gcloud projects get-iam-policy $PROJECT_ID --format=json > iam-audit.json
python3 analyze-iam.py iam-audit.json

# 2. Firebaseセキュリティルール検証
echo "## Firestoreセキュリティルール検証"
firebase emulators:exec --only firestore "npm run test:security-rules"

# 3. 依存関係脆弱性チェック
echo "## 依存関係脆弱性チェック"
npm audit --audit-level=moderate

# 4. 設定ファイル検証
echo "## 設定ファイル検証"
terraform plan -detailed-exitcode

# 5. SSL/TLS設定確認
echo "## SSL/TLS設定確認"
nmap --script ssl-enum-ciphers -p 443 your-domain.com

echo "=== チェック完了 ==="
```

## 10. セキュリティ教育・啓発

### 10.1 セキュリティガイドライン

個人開発者向けセキュリティチェックリスト：

- [ ] 定期的なパスワード変更（3 ヶ月毎）
- [ ] 二要素認証の有効化
- [ ] 依存関係の定期更新
- [ ] セキュリティパッチの迅速適用
- [ ] ログの定期確認
- [ ] バックアップの定期テスト
- [ ] 権限設定の定期見直し
- [ ] セキュリティ設定の文書化

### 10.2 緊急連絡先

- **Google Cloud Support**: <https://cloud.google.com/support>
- **Firebase Support**: <https://firebase.google.com/support>
- **JPCERT/CC**: <https://www.jpcert.or.jp/>
- **IPA セキュリティセンター**: <https://www.ipa.go.jp/security/>

このセキュリティ設計書は、脅威の変化や新しい脆弱性の発見に応じて定期的に更新してください。

## 11. 公開リポジトリでのセキュリティ考慮事項

### 11.1 機密情報管理

#### 11.1.1 GitHub Secrets の活用

```bash
# 機密情報は全てGitHub Secretsで管理
# リポジトリ設定 > Secrets and variables > Actions

# 環境別シークレット管理
STAGING_*    # ステージング環境用
PRODUCTION_* # 本番環境用
```

#### 11.1.2 .env.example の活用

```bash
# .env.example（公開OK）
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id_here

# 実際の値は.env.local（.gitignoreに追加）
NEXT_PUBLIC_FIREBASE_API_KEY=actual_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=techsnap-staging.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=techsnap-staging
```

### 11.2 公開リポジトリチェックリスト

#### 11.2.1 コミット前チェック

- [ ] API キーやパスワードが含まれていないか
- [ ] .env.local が.gitignore に含まれているか
- [ ] サービスアカウントキーが含まれていないか
- [ ] データベース接続文字列が含まれていないか
- [ ] 個人情報やテストデータが含まれていないか

#### 11.2.2 自動チェック設定

```yaml
# .github/workflows/security-check.yml
name: Security Check
on: [push, pull_request]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Run truffleHog
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: main
          head: HEAD
```

### 11.3 緊急時対応（機密情報漏洩時）

#### 11.3.1 即座に実行すべき対応

```bash
# 1. 該当シークレットの無効化
# Firebase: コンソールでAPIキー無効化
# Google Cloud: サービスアカウントキー削除

# 2. 新しいシークレット生成・設定
# 3. GitHub Secretsの更新
# 4. 緊急デプロイ実行

# 5. Git履歴からの削除（必要に応じて）
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch path/to/sensitive/file' \
  --prune-empty --tag-name-filter cat -- --all
```

#### 11.3.2 事後対応

- [ ] 影響範囲の調査
- [ ] セキュリティログの確認
- [ ] 再発防止策の実装
- [ ] インシデント報告書の作成
