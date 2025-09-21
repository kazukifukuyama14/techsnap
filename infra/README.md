# Terraform 環境概要

## ディレクトリ構成

```bash
infra/
  prod/
    main/        # prod 環境の Terraform ルート
    modules/     # prod 共通モジュール
    variables/   # prod 向け tfvars など
    output/      # plan/apply 出力の管理場所
  staging/
    main/
    modules/
    variables/
    output/
```

## バックエンド (GCS) 作成コマンド例

Terraform ステート用バケットは手動でブートストラップしています。
命名規則: `techsnap-<env>-backet-<乱数>`

```bash
# prod
BUCKET_PROD="techsnap-prod-backet-76421"
gcloud storage buckets create gs://${BUCKET_PROD} \
  --location=asia-northeast1 \
  --uniform-bucket-level-access

gcloud storage buckets update gs://${BUCKET_PROD} --versioning

# staging
BUCKET_STG="techsnap-staging-backet-59384"
gcloud storage buckets create gs://${BUCKET_STG} \
  --location=asia-northeast1 \
  --uniform-bucket-level-access

gcloud storage buckets update gs://${BUCKET_STG} --versioning
```

## ADC (Application Default Credentials) 導入手順

Terraform から GCP へアクセスするため、ローカル端末で ADC を設定します。

```bash
# ブラウザ認証 (GUI を開けない場合は --no-launch-browser 指定)
gcloud auth application-default login --no-launch-browser
```

認証後、`~/.config/gcloud/application_default_credentials.json` が生成されます。
Terraform で初期化する際は、各環境ディレクトリで以下を実行します。

```bash
cd infra/staging/main
terraform init \
  -backend-config=bucket=techsnap-staging-backet-59384 \
  -backend-config=prefix=terraform/staging

cd infra/prod/main
terraform init \
  -backend-config=bucket=techsnap-prod-backet-76421 \
  -backend-config=prefix=terraform/prod
```
