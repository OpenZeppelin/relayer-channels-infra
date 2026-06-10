# ---------------------------------------------------------------------------
# Secret Manager
#
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret" "relayer_api_key" {
  project   = var.project_id
  secret_id = "${local.app_name}-relayer-api-key"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "relayer_api_key" {
  secret      = google_secret_manager_secret.relayer_api_key.id
  secret_data = var.relayer_api_key

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret" "channels_admin_secret" {
  project   = var.project_id
  secret_id = "${local.app_name}-channels-admin-secret"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "channels_admin_secret" {
  secret      = google_secret_manager_secret.channels_admin_secret.id
  secret_data = var.channels_admin_secret

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret" "webhook_signing_key" {
  count = var.webhook_signing_key != "" ? 1 : 0

  project   = var.project_id
  secret_id = "${local.app_name}-webhook-signing-key"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "webhook_signing_key" {
  count = var.webhook_signing_key != "" ? 1 : 0

  secret      = google_secret_manager_secret.webhook_signing_key[0].id
  secret_data = var.webhook_signing_key

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret" "storage_encryption_key" {
  count = var.storage_encryption_key != "" ? 1 : 0

  project   = var.project_id
  secret_id = "${local.app_name}-storage-encryption-key"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "storage_encryption_key" {
  count = var.storage_encryption_key != "" ? 1 : 0

  secret      = google_secret_manager_secret.storage_encryption_key[0].id
  secret_data = var.storage_encryption_key

  lifecycle {
    ignore_changes = [secret_data]
  }
}

# ---------------------------------------------------------------------------
# IAM: Allow Cloud Run service account to access secrets
# ---------------------------------------------------------------------------
locals {
  secret_ids = concat(
    [
      google_secret_manager_secret.relayer_api_key.secret_id,
      google_secret_manager_secret.channels_admin_secret.secret_id,
    ],
    var.webhook_signing_key != "" ? [google_secret_manager_secret.webhook_signing_key[0].secret_id] : [],
    var.storage_encryption_key != "" ? [google_secret_manager_secret.storage_encryption_key[0].secret_id] : [],
  )
}

resource "google_secret_manager_secret_iam_member" "cloud_run_access" {
  for_each = toset(local.secret_ids)

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}
