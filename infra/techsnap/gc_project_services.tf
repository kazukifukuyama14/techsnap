# 共通で必要となる Google Cloud API の有効化リソース
resource "google_project_service" "required" {
  for_each = toset(local.required_project_services)

  project            = local.project_id
  service            = each.value
  disable_on_destroy = false
}
