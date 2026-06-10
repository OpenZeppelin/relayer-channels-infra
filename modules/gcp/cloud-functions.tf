# ---------------------------------------------------------------------------
# Cloud Functions: Balance Check (optional)
#
# Periodically checks relayer balance and publishes Cloud Monitoring metrics.
#
# NOTE: Cloud Functions v2 requires a Cloud Storage bucket for source code.
# The balance check and restart logic reuse the same JavaScript source from
# the AWS module but would need GCP-specific adaptations (e.g., using
# Cloud Monitoring API instead of CloudWatch, Secret Manager instead of SSM).
#
# This file provides the infrastructure scaffolding. The function source
# code should be placed in a GCS bucket and referenced here.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Cloud Storage bucket for function source code
# ---------------------------------------------------------------------------
resource "google_storage_bucket" "functions_source" {
  count = var.enable_balance_check_function ? 1 : 0

  project  = var.project_id
  name     = "${local.app_name}-functions-source-${var.project_id}"
  location = var.region

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  labels = local.labels

  depends_on = [google_project_service.apis["cloudfunctions.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Service Account for Cloud Functions
# ---------------------------------------------------------------------------
resource "google_service_account" "functions" {
  count = var.enable_balance_check_function ? 1 : 0

  project      = var.project_id
  account_id   = "${local.app_name}-fn"
  display_name = "Cloud Functions service account for ${local.app_name}"
}

# IAM: Allow function SA to read secrets
resource "google_project_iam_member" "functions_secret_accessor" {
  count = var.enable_balance_check_function ? 1 : 0

  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.functions[0].email}"
}

# IAM: Allow function SA to write metrics
resource "google_project_iam_member" "functions_monitoring" {
  count = var.enable_balance_check_function ? 1 : 0

  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.functions[0].email}"
}

# ---------------------------------------------------------------------------
# Cloud Scheduler: Balance Check Schedule
#
# ---------------------------------------------------------------------------
resource "google_cloud_scheduler_job" "balance_check" {
  count = var.enable_balance_check_function ? 1 : 0

  project  = var.project_id
  name     = "${local.app_name}-balance-check"
  region   = var.region
  schedule = var.balance_check_schedule

  http_target {
    uri         = google_cloudfunctions2_function.balance_check[0].url
    http_method = "POST"

    oidc_token {
      service_account_email = google_service_account.functions[0].email
    }
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Cloud Function: Balance Check
# ---------------------------------------------------------------------------
resource "google_cloudfunctions2_function" "balance_check" {
  count = var.enable_balance_check_function ? 1 : 0

  project  = var.project_id
  name     = "${local.app_name}-balance-check"
  location = var.region

  build_config {
    runtime     = "nodejs22"
    entry_point = "handler"

    source {
      storage_source {
        bucket = google_storage_bucket.functions_source[0].name
        object = "balance-check/source.zip"
      }
    }
  }

  service_config {
    max_instance_count    = 1
    timeout_seconds       = 60
    service_account_email = google_service_account.functions[0].email

    environment_variables = {
      BALANCE_URL                  = "https://${var.domain_name}/api/v1/relayers/${var.fund_relayer_id}/balance"
      EXTRA_BALANCE_URLS           = var.balance_check_extra_urls
      RELAYERS_URL                 = "https://${var.domain_name}/api/v1/relayers"
      PLUGINS_CALL_URL             = "https://${var.domain_name}/api/v1/plugins/channels/call"
      RELAYER_API_KEY_SECRET       = google_secret_manager_secret.relayer_api_key.secret_id
      CHANNELS_ADMIN_SECRET_SECRET = google_secret_manager_secret.channels_admin_secret.secret_id
      ENVIRONMENT                  = var.environment
      GCP_PROJECT_ID               = var.project_id
    }
  }

  labels = local.labels

  depends_on = [google_project_service.apis["cloudfunctions.googleapis.com"]]
}

# IAM: Allow Cloud Scheduler to invoke the balance check function
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  count = var.enable_balance_check_function ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.balance_check[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.functions[0].email}"
}

