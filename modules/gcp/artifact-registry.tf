# ---------------------------------------------------------------------------
# Artifact Registry
#
# Private Docker repository for storing relayer container images.
# Cloud Run pulls images from here using its dedicated service account (google_service_account.cloud_run).
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "this" {
  project       = var.project_id
  location      = var.region
  repository_id = local.app_name
  format        = "DOCKER"
  description   = "Container images for ${local.app_name}"

  cleanup_policy_dry_run = false

  labels = local.labels

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}

# Grant the Cloud Run service account read access to pull images
resource "google_artifact_registry_repository_iam_member" "cloud_run_reader" {
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.this.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.cloud_run.email}"
}
