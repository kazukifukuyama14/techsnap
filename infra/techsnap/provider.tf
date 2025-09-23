# Providerの定義
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # バックエンドの詳細値は各環境の backend 設定ファイルから読み込む
  backend "gcs" {}
}

# Google Cloudのプロバイダー設定
provider "google" {
  project = local.project_id
  region  = local.region
}
