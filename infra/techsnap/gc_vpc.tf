# VPC の定義
resource "google_compute_network" "techsnap_vpc" {
  name                    = "techsnap-vpc"
  auto_create_subnetworks = false
  description             = "TechsnapプロジェクトのVPC"
}

# 環境を選択する変数
variable "environment" {
  description = "デプロイメント環境（本番環境、ステージング環境）"
  type        = string
}

# サブネットの定義
resource "google_compute_subnetwork" "techsnap_subnet" {
  name          = "techsnap-subnet"
  ip_cidr_range = local.subnet_cidr
  region        = var.region
  network       = google_compute_network.techsnap_vpc.id
  description   = "Techsnapプロジェクトのサブネット"
}

# リージョン指定用の変数
variable "region" {
  description = "リソースが作成されるリージョン"
  type        = string
  default     = "asia-northeast1"
}
