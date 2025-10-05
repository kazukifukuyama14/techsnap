# Datastore 用の IAM ロール付与
resource "google_project_iam_member" "cloud_run_datastore_roles" {
  for_each = toset(var.datastore_iam_roles)

  project = local.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}
