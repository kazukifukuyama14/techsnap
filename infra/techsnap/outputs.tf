# Artifact Registry outputs
output "artifact_registry_repository_id" {
  description = "Artifact Registry repository id"
  value       = google_artifact_registry_repository.this.repository_id
}

# Artifact Registry repository name
output "artifact_registry_repository_location" {
  description = "Artifact Registry location"
  value       = google_artifact_registry_repository.this.location
}

# Artifact Registry repository format
output "artifact_registry_repository_path" {
  description = "Fully qualified Artifact Registry path"
  value       = "${google_artifact_registry_repository.this.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.this.repository_id}"
}
