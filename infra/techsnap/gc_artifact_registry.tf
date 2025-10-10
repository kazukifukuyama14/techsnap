# Artifact Registry リポジトリと IAM 設定
locals {
  # 環境名の正規化
  artifact_registry_env = coalesce(var.env, local.environment_normalized)
  # リポジトリ名の設定
  artifact_registry_repository = var.artifact_registry_settings.repository_name
  # リポジトリの場所
  artifact_registry_location = var.artifact_registry_settings.location
  # リポジトリのフォーマット
  artifact_registry_format = var.artifact_registry_settings.format
  # 古いイメージを保持するバージョン数
  artifact_registry_keep_count  = var.artifact_registry_settings.cleanup_keep_version
  artifact_registry_delete_tags = upper(var.artifact_registry_settings.cleanup_delete_tag_state)
  # 環境名の正規化 (小文字)
  artifact_registry_member_email = var.service_account_email != "" ? var.service_account_email : google_service_account.cloud_run.email
}

# Artifact Registry リポジトリの作成
resource "google_artifact_registry_repository" "this" {
  project       = var.project_id
  location      = local.artifact_registry_location
  repository_id = local.artifact_registry_repository
  description   = "Artifact Registry for ${var.project_settings.project} ${local.artifact_registry_env} containers"
  format        = local.artifact_registry_format

  cleanup_policy_dry_run = false

  # 古いイメージを管理するためのクリーンアップポリシー
  cleanup_policies {
    id     = "delete-cleanup-container-${local.artifact_registry_env}"
    action = "DELETE"

    condition {
      tag_state = local.artifact_registry_delete_tags
    }
  }

  # イメージのバージョンを保持するためのクリーンアップポリシーs
  cleanup_policies {
    id     = "retain-cleanup-container-${local.artifact_registry_env}"
    action = "KEEP"

    most_recent_versions {
      keep_count = local.artifact_registry_keep_count
    }
  }
}

# Artifact Registry リポジトリへの IAM 権限の付与 (管理者)
resource "google_artifact_registry_repository_iam_member" "artifact_registry_admin" {
  repository = google_artifact_registry_repository.this.id
  role       = "roles/artifactregistry.admin"
  member     = "serviceAccount:${local.artifact_registry_member_email}"
}

# Artifact Registry リポジトリへの IAM 権限の付与 (読み取り専用)
resource "google_artifact_registry_repository_iam_member" "artifact_registry_reader" {
  repository = google_artifact_registry_repository.this.id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.cloud_run.email}"
}
