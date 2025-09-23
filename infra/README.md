# Techsnap Terraform 運用ガイド

## ディレクトリ構成

```bash
infra/techsnap/
  env/
    prod.tfvars            # 本番環境の変数定義
    staging.tfvars         # ステージング環境の変数定義
    prod.backend.hcl       # 本番用バックエンド設定 (GCS)
    staging.backend.hcl    # ステージング用バックエンド設定 (GCS)
  gc_*.tf                  # 各種 GCP リソース定義
  locals.tf                # 共通ローカル変数
  provider.tf              # プロバイダ定義と backend スタブ
  valiables.tf             # ルートモジュール変数定義
```

## GCS バケット (Terraform ステート) 準備手順

Terraform は GCS バケットを backend として利用します。環境ごとにバケットを用意し、操作前に `gcloud` の対象プロジェクトを切り替えてください。

### ステージング環境

1. `gcloud config set project <staging-project-id>`
2. `gcloud storage buckets create gs://techsnap-staging-bucket-59384 \`
   `--location=asia-northeast1` `--uniform-bucket-level-access`
3. 変数ファイルをバケットへアップロード

   ```bash
   gcloud storage cp infra/techsnap/env/staging.tfvars \
     gs://techsnap-staging-bucket-59384/staging.tfvars
   ```

### 本番環境

1. `gcloud config set project <prod-project-id>`
2. `gcloud storage buckets create gs://techsnap-prod-bucket-76421 \`
   `--location=asia-northeast1` `--uniform-bucket-level-access`
3. `prod.tfvars` をアップロード

   ```bash
   gcloud storage cp infra/techsnap/env/prod.tfvars \
     gs://techsnap-prod-bucket-76421/prod.tfvars
   ```

> 旧バケット (`techsnap-*-backet-*`) を使用していた場合は、必要なステート/変数ファイルを新バケットへコピー後、不要になったタイミングで削除してください。

## Terraform の初期化

`provider.tf` の backend ブロックは空定義になっているため、環境ごとに HCL ファイルを渡して初期化します。

```bash
cd infra/techsnap

# ステージング
gcloud config set project <staging-project-id>
terraform init -reconfigure -backend-config=env/staging.backend.hcl

# 本番
gcloud config set project <prod-project-id>
terraform init -reconfigure -backend-config=env/prod.backend.hcl
```

`env/*.backend.hcl` では以下のようにバケット名とプレフィックスを指定します。

```bash
# env/staging.backend.hcl
bucket = "techsnap-staging-bucket-59384"
prefix = "infra/techsnap"

# env/prod.backend.hcl
bucket = "techsnap-prod-bucket-76421"
prefix = "infra/techsnap"
```

## plan / apply のワークフロー

1. 環境ごとの変数ファイルを指定して `terraform plan` を実行

   ```bash
   mkdir -p plan
   terraform plan -var-file=env/staging.tfvars -out=plan/staging.tfplan
   terraform plan -var-file=env/prod.tfvars -out=plan/prod.tfplan
   ```

2. 保存した plan を確認後、`terraform apply` で適用

   ```bash
   terraform apply plan/staging.tfplan
   terraform apply plan/prod.tfplan
   ```

   ※ `-out` を使わない場合は `terraform apply -var-file=env/<env>.tfvars` でも問題ありません。

## 環境切り替え時の注意点

- `terraform init -reconfigure -backend-config=...` を環境ごとに必ず実行してから plan / apply に進んでください。ステートが混ざると、別プロジェクトのリソースを誤って操作する恐れがあります。
- `terraform state list` や `terraform state show` で現在の backend が想定どおりのプロジェクトになっているか確認すると安全です。
- 同じディレクトリで複数環境を扱う場合は、作業前に `gcloud config set project ...` でアクティブプロジェクトを切り替えることを忘れないでください。

## バケット移行時の参考手順

旧バケットから新バケットへステートを移行する際の例です。

```bash
# バケット内容をローカルへバックアップ
gcloud storage cp gs://techsnap-staging-backet-59384/infra/techsnap/default.tfstate ./backup/

# 新バケット作成後にアップロード
gcloud storage cp ./backup/default.tfstate \
  gs://techsnap-staging-bucket-59384/infra/techsnap/default.tfstate

# 新バケットで Terraform を再初期化
terraform init -reconfigure -backend-config=env/staging.backend.hcl
```

本ドキュメントの手順に沿って作業すれば、ステージング・本番いずれの環境でも安全に Terraform を運用できます。
