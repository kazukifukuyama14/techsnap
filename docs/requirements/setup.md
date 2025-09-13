# 構築手順書（マルチアカウント対応）

## 概要

技術記事要約サービス「TechSnap」のマルチアカウント構築による開発環境構築からデプロイまでの手順を記載します。

## 前提条件

### 必要なツール

- Node.js 18.x 以上
- npm または yarn
- Docker Desktop
- Google Cloud CLI (gcloud)
- Terraform 1.5 以上
- Git

### 必要なアカウント

- Google Cloud アカウント（課金設定済み）
- Google Cloud Organization（推奨）
- GitHub アカウント
- ChatLLM API アカウント

## 1. マルチアカウント環境セットアップ

### 1.1 Google Cloud 環境確認

```bash
# 組織の確認
gcloud organizations list

# 課金アカウント確認
gcloud billing accounts list
export BILLING_ACCOUNT_ID=01236F-395968-EA4498  # 実際の課金アカウントIDに置き換えてください
```

**重要**:

- 組織が存在しない場合（`Listed 0 items.`）は、組織オプションなしでプロジェクトを作成します
- 組織が存在する場合のみ、`--organization=$ORG_ID`オプションを使用します

### 1.2 マルチアカウント作成

#### 1.2.1 管理アカウント作成

```bash
# 管理アカウント作成（組織なしの場合 - 推奨）
gcloud projects create techsnap-mgmt --name="TechSnap Management"

# 組織ありの場合は以下を使用（組織IDが存在する場合のみ）
# export ORG_ID=123456789012  # 実際の数値IDに置き換え
# gcloud projects create techsnap-mgmt --name="TechSnap Management" --organization=$ORG_ID

# 課金設定
gcloud billing projects link techsnap-mgmt \
  --billing-account=$BILLING_ACCOUNT_ID

# 必要なAPIの有効化
gcloud config set project techsnap-mgmt
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  cloudbilling.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  cloudkms.googleapis.com
```

#### 1.2.2 ステージングアカウント作成

```bash
# ステージングアカウント作成（組織なしの場合 - 推奨）
gcloud projects create techsnap-staging --name="TechSnap Staging"

# 組織ありの場合は以下を使用（組織IDが存在する場合のみ）
# gcloud projects create techsnap-staging --name="TechSnap Staging" --organization=$ORG_ID

# 課金設定
gcloud billing projects link techsnap-staging \
  --billing-account=$BILLING_ACCOUNT_ID

# 必要なAPIの有効化
gcloud config set project techsnap-staging
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  firebase.googleapis.com
```

#### 1.2.3 本番アカウント作成

```bash
# 本番アカウント作成（組織なしの場合 - 推奨）
gcloud projects create techsnap-prod --name="TechSnap Production"

# 組織ありの場合は以下を使用（組織IDが存在する場合のみ）
# gcloud projects create techsnap-prod --name="TechSnap Production" --organization=$ORG_ID

# 課金設定
gcloud billing projects link techsnap-prod \
  --billing-account=$BILLING_ACCOUNT_ID

# 必要なAPIの有効化
gcloud config set project techsnap-prod
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  dns.googleapis.com \
  domains.googleapis.com \
  firebase.googleapis.com
```

### 1.3 クロスアカウントサービスアカウント作成

```bash
# 管理アカウントでCI/CD用サービスアカウント作成
gcloud config set project techsnap-mgmt

gcloud iam service-accounts create techsnap-cicd \
  --display-name="TechSnap CI/CD サービスアカウント" \
  --description="GitHub ActionsからのデプロイとTerraform実行用"

# サービスアカウントキー作成
gcloud iam service-accounts keys create cicd-sa-key.json \
  --iam-account=techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com

# Base64エンコード（GitHub Secretsで使用）
base64 -i cicd-sa-key.json
```

### 1.4 クロスアカウント権限設定

```bash
# ステージングアカウントへの権限付与
gcloud config set project techsnap-staging
gcloud projects add-iam-policy-binding techsnap-staging \
  --member="serviceAccount:techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com" \
  --role="roles/editor"

# 本番アカウントへの権限付与（制限付き）
gcloud config set project techsnap-prod
gcloud projects add-iam-policy-binding techsnap-prod \
  --member="serviceAccount:techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com" \
  --role="roles/run.developer"

gcloud projects add-iam-policy-binding techsnap-prod \
  --member="serviceAccount:techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com" \
  --role="roles/firebase.admin"

gcloud projects add-iam-policy-binding techsnap-prod \
  --member="serviceAccount:techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com" \
  --role="roles/firebase.admin"
```

## 2. 開発環境セットアップ

### 2.1 リポジトリ構成

#### 2.1.1 単一リポジトリ戦略

```
techsnap/
├── .github/
│   └── workflows/
│       ├── deploy-staging.yml      # ステージング環境デプロイ
│       └── deploy-production.yml   # 本番環境デプロイ
├── terraform/                      # インフラ設定（マルチアカウント対応）
├── src/                           # アプリケーションコード
├── .env.example                   # 環境変数テンプレート
├── firebase.json                  # Firebase設定
└── README.md
```

#### 2.1.2 ブランチ戦略

- **main**: 本番環境用（安定版）
- **develop**: ステージング環境用（開発版）
- **feature/\***: 機能開発用（develop から分岐）
- **hotfix/\***: 緊急修正用（main から分岐）

### 2.2 リポジトリクローン

```bash
# 単一公開リポジトリ（ステージング・本番両環境対応）
git clone https://github.com/[username]/techsnap.git
cd techsnap

# ブランチ構成確認
git branch -a

# 開発用ブランチに切り替え
git checkout develop
```

### 2.3 Node.js 依存関係インストール

#### 2.3-1 既存のプロジェクトファイルをバックアップ

```bash
mkdir ../techsnap-backup
mv .cursor .github .kiro README.md cicd-sa-key.json terraform ../techsnap-backup/
```

#### 2.3-2 Next.js プロジェクトの初期化とセットアップ

```bash
# プロジェクトディレクトリで実行
npx create-next-app@latest .

# 以下の質問に答えてください:
# ✔ Would you like to use TypeScript? · Yes
# ✔ Would you like to use ESLint? · Yes
# ✔ Would you like to use Tailwind CSS? · Yes
# ✔ Would you like to use `src/` directory? · Yes
# ✔ Would you like to use App Router? · Yes
# ✔ Would you like to customize the default import alias? · No
```

#### 2.3-3 TailwindCSS のセットアップ

```bash
# 必要なパッケージをインストール
npm install -D tailwindcss postcss autoprefixer

# 設定ファイルの初期化
npm pkg set scripts.tailwind-init="npx tailwindcss init -p"
npm run tailwind-init
```

`tailwind.config.js`の内容を以下のように更新：

```javascript
// filepath: tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
```

#### 2.3-4 TypeScript の設定

`tsconfig.json`を以下のように更新：

```json
// filepath: tsconfig.json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

#### 2.3-5 基本コンポーネントの作成

```typescript
// filepath: src/app/layout.tsx
import "./globals.css";
import { Inter } from "next/font/google";
import React from "react";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "TechSnap",
  description: "TechSnap Application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

```typescript
// filepath: src/app/page.tsx
import React from "react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <h1 className="text-4xl font-bold text-blue-600">Welcome to TechSnap</h1>
    </main>
  );
}
```

#### 2.3-6 バックアップしたファイルを復元

```bash
mv ../techsnap-backup/.cursor ../techsnap-backup/.github ../techsnap-backup/.kiro ../techsnap-backup/README.md ../techsnap-backup/cicd-sa-key.json ../techsnap-backup/terraform ./
```

#### 2.3-7 開発サーバーの起動

```bash
npm run dev
```

**注意点：**

- TypeScript のエラーが発生した場合は、必要な型定義をインストール：
  ```bash
  npm install --save-dev @types/react @types/node
  ```
- `next/font`のエラーが発生した場合は、`next.config.js`を確認：
  ```javascript
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    // 必要に応じて設定を追加
  };
  module.exports = nextConfig;
  ```

### 2.4 Firebase 設定

```bash
# Firebaseツールのインストール
npm install -g firebase-tools

# Firebaseにログイン
firebase login

# Firebaseプロジェクトの初期化
firebase init
```

設定時の選択項目：

- Hosting
- Firestore
- Functions
- Storage
- Emulators

#### 2.4.1 環境変数の設定

```bash
# .env.localファイルの作成
touch .env.local
```

```typescript
// filepath: .env.local
NEXT_PUBLIC_FIREBASE_API_KEY = "your-api-key";
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "your-project-id.firebaseapp.com";
NEXT_PUBLIC_FIREBASE_PROJECT_ID = "your-project-id";
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "your-project-id.appspot.com";
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "your-sender-id";
NEXT_PUBLIC_FIREBASE_APP_ID = "your-app-id";
```

### 2.5 Google Cloud 設定

#### 2.5.1 gcloud コマンドラインツールのインストール

```bash
# Homebrewを使用してインストール
brew install google-cloud-sdk

# 初期化
gcloud init
```

#### 2.5.2 プロジェクト設定

```bash
# プロジェクトの切り替え
gcloud config set project techsnap-prod

# 必要なAPIの有効化
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

### 2.6 デプロイメント設定

#### 2.6.1 GitHub Actions 設定

```yaml
# // filepath: .github/workflows/deploy-staging.yml
name: Deploy to Staging

on:
  push:
    branches:
      - develop

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm install

      - name: Build application
        run: npm run build

      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: "${{ secrets.GITHUB_TOKEN }}"
          firebaseServiceAccount: "${{ secrets.CICD_SA_KEY }}"
          projectId: "${{ secrets.FIREBASE_PROJECT_ID_STAGING }}"
```

```yaml
# // filepath: .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Cloud SDK
        uses: google-github-actions/setup-gcloud@v0
        with:
          service_account_key: ${{ secrets.GCP_SA_KEY }}
          project_id: ${{ secrets.GCP_PROJECT_ID }}

      - name: Build and Deploy
        run: |
          npm ci
          npm run build
          gcloud run deploy techsnap-prod --source .
```

### 2.7 ローカル開発環境の起動

```bash
# Firebaseエミュレータの起動
firebase emulators:start

# 別ターミナルでNext.js開発サーバーを起動
npm run dev
```

## 3. Firebase プロジェクト設定（マルチアカウント）

### 3.1 Firebase CLI セットアップ

```bash
# Firebase CLIインストール
npm install -g firebase-tools

# Firebase認証
firebase login

# 各アカウントでFirebaseプロジェクト初期化
```

### 3.2 ステージング環境 Firebase 設定

Firebase プロジェクトの設定手順:

1. GCP プロジェクトを Firebase に追加

   ```bash
   # GCP プロジェクトを Firebase プロジェクトとして有効化
   firebase projects:addfirebase techsnap-staging
   ```

2. 必要な API を有効化

   ```bash
   gcloud services enable \
     firebase.googleapis.com \
     firebaserules.googleapis.com \
     firestore.googleapis.com \
     identitytoolkit.googleapis.com \
     iam.googleapis.com \
     cloudresourcemanager.googleapis.com \
     firebaseapphosting.googleapis.com \
     --project=techsnap-staging
   ```

3. Firestore データベースを作成

   ```bash
   gcloud firestore databases create \
     --project=techsnap-staging \
     --location=asia-northeast1 \
     --type=firestore-native
   ```

4. Firebase Web アプリを作成

   ```bash
   firebase apps:create web techsnap-web --project techsnap-staging
   ```

5. Firebase 初期化
   ```bash
   firebase init --project techsnap-staging
   ```

### 3.3 本番環境 Firebase 設定

Firebase プロジェクトの設定手順:

1. GCP プロジェクトを Firebase に追加

   ```bash
   # GCP プロジェクトを Firebase プロジェクトとして有効化
   firebase projects:addfirebase techsnap-prod
   ```

2. 必要な API を有効化

   ```bash
   gcloud services enable \
     firebase.googleapis.com \
     firebaserules.googleapis.com \
     firestore.googleapis.com \
     identitytoolkit.googleapis.com \
     iam.googleapis.com \
     cloudresourcemanager.googleapis.com \
     firebaseapphosting.googleapis.com \
     --project=techsnap-prod
   ```

3. Firestore データベースを作成

   ```bash
   gcloud firestore databases create \
     --project=techsnap-prod \
     --location=asia-northeast1 \
     --type=firestore-native
   ```

4. Firebase Web アプリを作成

   ```bash
   firebase apps:create web techsnap-web-prod --project techsnap-prod
   ```

5. Firebase 初期化
   ```bash
   firebase init --project techsnap-prod
   ```

### 3.4 環境間の設定差分確認と同期

ステージング環境と本番環境の設定差分を確認し、必要に応じて同期するためのスクリプトを用意しています。

1. 環境設定のエクスポートと差分確認

   ```bash
   # 各環境の設定をエクスポート
   bash scripts/export_firebase_project.sh techsnap-staging
   bash scripts/export_firebase_project.sh techsnap-prod

   # 差分レポートを生成
   bash scripts/compare_stg_prod.sh techsnap-staging techsnap-prod
   ```

2. 同期計画の生成と実行

   ```bash
   # 同期計画を生成
   bash scripts/generate_sync_plan.sh techsnap-staging techsnap-prod

   # 生成された計画を確認し、必要な部分のみ実行
   bash env_audits/sync_plan_techsnap-staging_to_techsnap-prod.sh
   ```

これにより、ステージング環境と本番環境の設定を一貫性を持って管理できます。

### 3.5 Firestore セキュリティルール（共通）

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ユーザーは自分のデータのみアクセス可能
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // 要約は作成者のみアクセス可能
    match /summaries/{summaryId} {
      allow read, write: if request.auth != null &&
        request.auth.uid == resource.data.userId;
      allow create: if request.auth != null &&
        request.auth.uid == request.resource.data.userId;
    }

    // キャッシュは認証済みユーザーのみ読み取り可能
    match /cache/{cacheId} {
      allow read: if request.auth != null;
      allow write: if false; // サーバーサイドのみ
    }
  }
}
```

## 4. Terraform によるマルチアカウントインフラ構築

### 4.1 Terraform 初期化

```bash
# terraformディレクトリに移動
cd terraform

# Terraform初期化
terraform init

# フォーマット確認
terraform fmt -check

# 設定検証
terraform validate
```

### 4.2 管理アカウントでの Terraform ステート設定（CMEK）

Terraform のステートバケットにカスタマー管理鍵（CMEK）を設定します。鍵のロケーションは「バケットのロケーションと一致」させる必要があります（`global` は不可）。

```bash
# 管理アカウントに切り替え
export MGMT_PROJECT_ID=techsnap-mgmt
gcloud config set project ${MGMT_PROJECT_ID}

# 必要なら Cloud KMS API を明示的に有効化
gcloud services enable cloudkms.googleapis.com --project=${MGMT_PROJECT_ID}

# ステート保存用バケット作成（ロケーションは環境方針に合わせて指定）
# 例: 東京リージョン（asia-northeast1）に作成
export STATE_BUCKET=gs://techsnap-terraform-state
gsutil mb -p ${MGMT_PROJECT_ID} -l asia-northeast1 -b on ${STATE_BUCKET}

# バージョニング有効化
gsutil versioning set on ${STATE_BUCKET}

# バケットのロケーション確認（既存バケットの場合はこれで実ロケーションを取得）
BUCKET_LOCATION=$(gsutil ls -Lb ${STATE_BUCKET} | sed -n 's/.*Location:\s*//p' | head -n1)
echo "Bucket location: ${BUCKET_LOCATION}"

# KMS KeyRing/Key をバケットと同じロケーションに作成
export KMS_LOCATION=${BUCKET_LOCATION}
export KMS_KEYRING=terraform
export KMS_KEY=state

gcloud kms keyrings create ${KMS_KEYRING} \
  --location=${KMS_LOCATION} \
  --project=${MGMT_PROJECT_ID} || true  # 既存なら無視

gcloud kms keys create ${KMS_KEY} \
  --location=${KMS_LOCATION} \
  --keyring=${KMS_KEYRING} \
  --purpose=encryption \
  --project=${MGMT_PROJECT_ID} || true  # 既存なら無視

# Cloud Storage プロジェクトのサービスアカウントに鍵使用権限を付与
MGMT_PROJECT_NUMBER=$(gcloud projects describe ${MGMT_PROJECT_ID} --format='value(projectNumber)')
STORAGE_SA="service-${MGMT_PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com"

gcloud kms keys add-iam-policy-binding ${KMS_KEY} \
  --keyring=${KMS_KEYRING} \
  --location=${KMS_LOCATION} \
  --project=${MGMT_PROJECT_ID} \
  --member="serviceAccount:${STORAGE_SA}" \
  --role="roles/cloudkms.cryptoKeyEncrypterDecrypter"

# バケットのデフォルト暗号鍵に設定
KMS_RESOURCE="projects/${MGMT_PROJECT_ID}/locations/${KMS_LOCATION}/keyRings/${KMS_KEYRING}/cryptoKeys/${KMS_KEY}"
gsutil kms encryption -k ${KMS_RESOURCE} ${STATE_BUCKET}

# 代替: gcloud storage を使う場合
# gcloud storage buckets update ${STATE_BUCKET} --default-kms-key=${KMS_RESOURCE}

# 設定検証（暗号鍵が表示されればOK）
gsutil kms encryption ${STATE_BUCKET}
```

トラブルシュート:

- 404 Not Found（CryptoKey ... not found）: KeyRing/Key が存在しない、またはロケーションが一致していません。`KMS_LOCATION` がバケットの `Location` と一致しているか確認してください。
- 403 PERMISSION_DENIED（KMS API 未使用）: エラーメッセージに表示されるプロジェクト番号のプロジェクトで `cloudkms.googleapis.com` が有効か確認・有効化してください。通常はステートバケットを所有する管理プロジェクトです。

### 4.3 環境変数ファイル準備（マルチアカウント）

```bash
# 管理アカウント用変数ファイル作成
cat > env/mgmt.tfvars << EOF
mgmt_project_id = "techsnap-mgmt"
staging_project_id = "techsnap-staging"
prod_project_id = "techsnap-prod"
organization_id = "$ORG_ID"
billing_account_id = "$BILLING_ACCOUNT_ID"
region = "asia-northeast1"
EOF

# ステージング用変数ファイル作成
cat > env/staging.tfvars << EOF
environment = "staging"
project_id = "techsnap-staging"
region = "asia-northeast1"
cloud_run_min_instances = 0
cloud_run_max_instances = 3
firestore_tfree"
dns_enabled = false
EOF

# 本番用変数ファイル作成
cat > env/production.tfvars << EOF
environment = "production"
project_id = "techsnap-prod"
region = "asia-northeast1"
cloud_run_min_instances = 1
cloud_run_max_instances = 10
firestore_tier = "paid"
dns_enabled = true
domain_name = "your-domain.com"
EOF

# Cloud Storageに.tfvarsファイルをアップロード
gsutil cp env/*.tfvars gs://techsnap-terraform-state/env/
```

### 4.4 段階的インフラ構築

#### 4.4.1 管理アカウントインフラ構築

```bash
# 管理アカウント用ワークスペース作成
terraform workspace new mgmt

# 管理アカウントリソース構築
terraform apply -var-file="env/mgmt.tfvars" \
  -target="google_organization_*" \
  -target="google_billing_*" \
  -target="google_storage_terraform_state" \
  -target="google_iam_cross_account"
```

#### 4.4.2 ステージング環境構築

```bash
# ステージング用ワークスペース作成
terraform workspace new staging

# ステージング環境変数取得
gsutil cp gs://techsnap-terraform-state/env/staging.tfvars ./

# ステージング環境構築
terraform apply -var-file="staging.tfvars" \
  -target="google_project_staging" \
  -target="google_*_staging"
```

#### 4.4.3 本番環境構築

```bash
# 本番用ワークスペース作成
terraform workspace new prod

# 本番環境変数取得
gsutil cp gs://techsnap-terraform-state/env/production.tfvars ./

# 本番環境構築
terraform apply -var-file="production.tfvars" \
  -target="google_project_prod" \
  -target="google_*_prod"
```

## 5. ドメイン設定（本番環境のみ）

### 5.1 Google Cloud Domains でドメイン購入

```bash
# 本番アカウントに切り替え
gcloud config set project techsnap-prod

# 利用可能ドメイン検索
gcloud domains registrations search-domains --query="your-domain-name"

# ドメイン購入
gcloud domains registrations register your-domain.com \
  --contact-data-from-file=contact.yaml \
  --contact-privacy=private-contact-data \
  --yearly-price=12.00 \
  --currency=USD
```

### 5.2 Cloud DNS 設定

```bash
# DNSゾーン作成
gcloud dns managed-zones create techsnap-zone \
  --description="TechSnap DNSゾーン" \
  --dns-name="your-domain.com"

# ネームサーバー確認
gcloud dns managed-zones describe techsnap-zone
```

## 6. CI/CD 設定（マルチアカウント対応）

### 6.1 GitHub Secrets 設定

```bash
# リポジトリ設定 > Secrets and variables > Actions で設定

# 共通シークレット
CHATLLM_API_KEY=ChatLLM APIキー
FIREBASE_TOKEN=Firebase CLIトークン

# マルチアカウント用
MGMT_PROJECT_ID=techsnap-mgmt
STAGING_PROJECT_ID=techsnap-staging
PROD_PROJECT_ID=techsnap-prod

# CI/CDサービスアカウント
CICD_SA_KEY=base64エンコードされたCI/CDサービスアカウントキー

# Firebase プロジェクト別
FIREBASE_PROJECT_ID_STAGING=techsnap-staging
FIREBASE_PROJECT_ID_PROD=techsnap-prod
```

### 6.2 GitHub Actions 設定

#### 6.2.1 ステージング環境デプロイ

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging (Multi-Account)
on:
  push:
    branches: [develop]
  pull_request:
    branches: [develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v3

      - name: Setup Google Cloud CLI
        uses: google-github-actions/setup-gcloud@v1
        with:
          service_account_key: ${{ secrets.CICD_SA_KEY }}
          project_id: ${{ secrets.STAGING_PROJECT_ID }}

      - name: Configure Docker for GCR
        run: gcloud auth configure-docker

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build application
        run: npm run build
        env:
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID_STAGING }}

      - name: Build and push Docker image
        run: |
          docker build -t gcr.io/${{ secrets.STAGING_PROJECT_ID }}/techsnap:${{ github.sha }} .
          docker push gcr.io/${{ secrets.STAGING_PROJECT_ID }}/techsnap:${{ github.sha }}

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy techsnap \
            --image gcr.io/${{ secrets.STAGING_PROJECT_ID }}/techsnap:${{ github.sha }} \
            --platform managed \
            --region asia-northeast1 \
            --allow-unauthenticated \
            --project ${{ secrets.STAGING_PROJECT_ID }}

      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: "${{ secrets.GITHUB_TOKEN }}"
          firebaseServiceAccount: "${{ secrets.CICD_SA_KEY }}"
          projectId: "${{ secrets.STAGING_PROJECT_ID }}"
```

#### 6.2.2 本番環境デプロイ

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production (Multi-Account)
on:
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3

      - name: Setup Google Cloud CLI
        uses: google-github-actions/setup-gcloud@v1
        with:
          service_account_key: ${{ secrets.CICD_SA_KEY }}
          project_id: ${{ secrets.PROD_PROJECT_ID }}

      - name: Configure Docker for GCR
        run: gcloud auth configure-docker

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build application
        run: npm run build
        env:
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID_PROD }}

      - name: Build and push Docker image
        run: |
          docker build -t gcr.io/${{ secrets.PROD_PROJECT_ID }}/techsnap:${{ github.sha }} .
          docker push gcr.io/${{ secrets.PROD_PROJECT_ID }}/techsnap:${{ github.sha }}

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy techsnap \
            --image gcr.io/${{ secrets.PROD_PROJECT_ID }}/techsnap:${{ github.sha }} \
            --platform managed \
            --region asia-northeast1 \
            --allow-unauthenticated \
            --project ${{ secrets.PROD_PROJECT_ID }}

      - Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: "${{ secrets.GITHUB_TOKEN }}"
          firebaseServiceAccount: "${{ secrets.CICD_SA_KEY }}"
          projectId: "${{ secrets.PROD_PROJECT_ID }}"
```

## 7. 開発サーバー起動

### 7.1 Firebase Emulator 起動

```bash
# エミュレーター起動（ステージング設定）
firebase emulators:start --project techsnap-staging

# バックグラウンド起動
firebase emulators:start --only firestore,auth --project techsnap-staging
```

### 7.2 Next.js 開発サーバー起動

```bash
# 開発サーバー起動
npm run dev

# ポート指定
npm run dev -- -p 3001
```

### 7.3 動作確認

```bash
# ローカル環境確認
curl http://localhost:3000/api/health

# Firebase Emulator確認
curl http://localhost:5000

# ステージング環境確認
curl https://techsnap-staging-[hash]-an.a.run.app/api/health

# 本番環境確認（ドメイン設定後）
curl https://your-domain.com/api/health
```

## 8. マルチアカウント運用のベストプラクティス

### 8.1 アカウント切り替え

```bash
# 現在のプロジェクト確認
gcloud config get-value project

# アカウント切り替え用エイリアス設定
alias gcloud-mgmt='gcloud config set project techsnap-mgmt'
alias gcloud-staging='gcloud config set project techsnap-staging'
alias gcloud-prod='gcloud config set project techsnap-prod'

# 使用例
gcloud-staging
gcloud run services list
```

### 8.2 権限管理

```bash
# 各アカウントの権限確認
gcloud projects get-iam-policy techsnap-mgmt
gcloud projects get-iam-policy techsnap-staging
gcloud projects get-iam-policy techsnap-prod

# 不要な権限の削除
gcloud projects remove-iam-policy-binding PROJECT_ID \
  --member="user:example@gmail.com" \
  --role="roles/editor"
```

### 8.3 コスト管理

```bash
# アカウント別コスト確認
gcloud billing budgets list --billing-account=$BILLING_ACCOUNT_ID

# アカウント別予算設定
gcloud billing budgets create \
  --billing-account=$BILLING_ACCOUNT_ID \
  --display-name="ステージング環境予算" \
  --budget-amount=10USD \
  --threshold-percent=80,100 \
  --filter-projects=techsnap-staging
```

## 9. トラブルシューティング

### 9.1 プロジェクト作成時のエラー

**エラー: Parent id must be numeric**

```bash
# 組織IDが数値でない場合のエラー
# 解決方法: 組織IDを数値で指定するか、組織オプションを省略
gcloud organizations list  # 数値のIDを確認
export ORG_ID=123456789012  # 数値のIDを設定

# または組織なしでプロジェクト作成
gcloud projects create techsnap-mgmt --name="TechSnap Management"
```

**エラー: project display name contains invalid characters**

```bash
# 日本語の括弧などが含まれている場合のエラー
# 解決方法: 英数字とスペース、ハイフンのみ使用
gcloud projects create techsnap-mgmt --name="TechSnap Management"  # OK
gcloud projects create techsnap-mgmt --name="TechSnap（管理）"      # NG
```

### 9.2 よくある問題

**クロスアカウント権限エラー**

```bash
# サービスアカウント権限確認
gcloud projects get-iam-policy PROJECT_ID --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com"
```

**Terraform 状態ファイルアクセスエラー**

```bash
# バケット権限確認
gsutil iam get gs://techsnap-terraform-state
```

**Firebase プロジェクト切り替えエラー**

```bash
# Firebase プロジェクト一覧確認
firebase projects:list

# プロジェクト切り替え
firebase use techsnap-staging
```

### 9.2 ログ確認

```bash
# アカウント別Cloud Runログ
gcloud logging read "resource.type=cloud_run_revision" --project=techsnap-staging --limit=50
gcloud logging read "resource.type=cloud_run_revision" --project=techsnap-prod --limit=50

# Terraformログ
terraform show -json | jq '.values.root_module.resources[] | select(.type=="google_project")'
```

## 10. 初期セットアップ確認

### 10.1 プロジェクト作成確認

```bash
# 作成したプロジェクト一覧確認
gcloud projects list --filter="name:techsnap"

# 各プロジェクトの詳細確認
gcloud projects describe techsnap-mgmt
gcloud projects describe techsnap-staging
gcloud projects describe techsnap-prod
```

### 10.2 サービスアカウント確認

```bash
# 管理プロジェクトのサービスアカウント確認
gcloud config set project techsnap-mgmt
gcloud iam service-accounts list

# サービスアカウントの詳細確認
gcloud iam service-accounts describe techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com
```

### 10.3 権限設定確認

```bash
# ステージングプロジェクトの権限確認
gcloud config set project techsnap-staging
gcloud projects get-iam-policy techsnap-staging --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com"

# 本番プロジェクトの権限確認
gcloud config set project techsnap-prod
gcloud projects get-iam-policy techsnap-prod --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:techsnap-cicd@techsnap-mgmt.iam.gserviceaccount.com"
```

### 10.4 課金設定確認

```bash
# 各プロジェクトの課金設定確認
gcloud billing projects describe techsnap-mgmt
gcloud billing projects describe techsnap-staging
gcloud billing projects describe techsnap-prod
```

### 10.5 Google Cloud コンソールでの確認

1. **プロジェクト確認**: [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト選択ドロップダウンを確認
2. **IAM 確認**: 各プロジェクトで **IAM と管理** > **IAM** を確認
3. **サービスアカウント確認**: **IAM と管理** > **サービス アカウント** を確認
4. **課金確認**: [課金コンソール](https://console.cloud.google.com/billing) でプロジェクトリンクを確認

## 11. 初回デプロイ確認

### 10.1 各環境の確認

```bash
# ステージング環境確認
gcloud run services list --platform=managed --project=techsnap-staging
firebase hosting:sites:list --project=techsnap-staging

# 本番環境確認
gcloud run services list --platform=managed --project=techsnap-prod
firebase hosting:sites:list --project=techsnap-prod

# ドメイン設定確認
nslookup your-domain.com

# SSL証明書確認
curl -I https://your-domain.com
```

### 10.2 マルチアカウント構築完了確認

```bash
# 全アカウントのプロジェクト一覧
gcloud projects list --filter="name:techsnap"

# 各アカウントのリソース確認
for project in techsnap-mgmt techsnap-staging techsnap-prod; do
  echo "=== $project ==="
  gcloud config set project $project
  gcloud services list --enabled --filter="name:run OR name:firestore OR name:firebase"
done
```

## 11. 次のステップ

マルチアカウント構築完了後は以下を実施：

1. **監視設定**: 各アカウントで Google Cloud Monitoring でアラート設定
2. **バックアップ設定**: 各環境の Firestore の自動バックアップ設定
3. **セキュリティ監査**: 各アカウントの権限設定の最終確認
4. **パフォーマンステスト**: 各環境での負荷テストの実施
5. **運用手順確認**: マルチアカウント対応の運用設計書に従った手順確認

詳細は運用設計書を参照してください。
