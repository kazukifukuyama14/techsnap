# Prefetch feeds Cloud Run Job
resource "google_cloud_run_v2_job" "prefetch_feeds" {
  name     = "prefetch-feeds"
  location = var.region

  template {
    template {
      containers {
        image = "${var.prefetch_feeds_image}"

        env {
          name  = "FEED_CRON_ORIGIN"
          value = var.feed_cron_origin
        }

        env {
          name  = "FORCE_REFRESH"
          value = var.force_refresh
        }
      }
    }
  }
}

# Cloud Scheduler -> Cloud Run Job
resource "google_cloud_scheduler_job" "prefetch_feeds_schedule" {
  name        = var.cloud_scheduler_settings.job_name
  description = var.cloud_scheduler_settings.description
  schedule    = var.cloud_scheduler_settings.schedule
  time_zone   = var.cloud_scheduler_settings.time_zone
  region      = var.region
  project     = var.project_id

  retry_config {
    retry_count          = var.cloud_scheduler_settings.retry_count
    max_retry_duration   = var.cloud_scheduler_settings.max_duration
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 5
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.prefetch_feeds.name}:run"
    oidc_token {
      service_account_email = google_service_account.cloud_run.email
      audience              = "https://${var.region}-run.googleapis.com/"
    }
  }
}
