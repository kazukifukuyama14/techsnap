# ローカル変数の定義
locals {
  environment            = var.environment
  environment_normalized = lower(var.environment)
  project_id             = "techsnap-${local.environment_normalized}"
  region                 = var.region
  zone                   = "${var.region}-a"
  # `prod` もしくは `production` の場合のみ本番扱いにする
  is_production = contains(["prod", "production"], local.environment_normalized)
  subnet_cidr   = local.is_production ? "10.0.1.0/24" : "10.0.2.0/24"
  # リソース名共通prefix
  prefix = "${var.project_settings.project}-${local.environment_normalized}"
}
