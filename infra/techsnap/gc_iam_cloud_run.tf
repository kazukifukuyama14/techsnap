# Cloud Run 用のサービスアカウントと IAM ロールの設定
locals {
  cloud_run_service_account_id = coalesce(
    try(var.iam_settings.service_account_name, null),
    "cloud-run-${local.environment_normalized}"
  )
}

# IAM 用のサービスアカウントの作成
resource "google_service_account" "cloud_run" {
  project      = local.project_id
  account_id   = local.cloud_run_service_account_id
  display_name = "Cloud Run (${local.environment_normalized})"
}

# IAM ロールの付与
resource "google_project_iam_member" "cloud_run_roles" {
  for_each = toset(var.iam_settings.roles)

  project = local.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}
