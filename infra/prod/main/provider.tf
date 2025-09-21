terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.30"
    }
  }

  backend "gcs" {
    bucket = "techsnap-prod-backet-76421"
    prefix = "terraform/prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

locals {
  default_labels = merge(
    {
      environment = var.environment
      managed_by  = "terraform"
      project     = var.project_id
      workload    = "techsnap"
    },
    var.additional_labels,
  )
}
