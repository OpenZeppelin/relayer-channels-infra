# ---------------------------------------------------------------------------
# Service Account for Cloud Run
# ---------------------------------------------------------------------------
resource "google_service_account" "cloud_run" {
  project      = var.project_id
  account_id   = "${local.app_name}-run"
  display_name = "Cloud Run service account for ${local.app_name}"
}

# ---------------------------------------------------------------------------
# Serverless VPC Access Connector
#
# Cloud Run needs this to reach Memorystore (private IP only).
# ---------------------------------------------------------------------------
resource "google_vpc_access_connector" "this" {
  project       = var.project_id
  name          = "${local.app_name}-vpc"
  region        = var.region
  ip_cidr_range = var.connector_ip_cidr_range
  network       = var.network
  machine_type  = var.connector_machine_type
  min_instances = var.connector_min_instances
  max_instances = var.connector_max_instances

  depends_on = [google_project_service.apis["vpcaccess.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Managed container environment variables (merged with user-provided ones)
# ---------------------------------------------------------------------------
locals {
  managed_environment = [
    { name = "HOST", value = "0.0.0.0" },
    { name = "REPOSITORY_STORAGE_TYPE", value = "redis" },
    { name = "RESET_STORAGE_ON_START", value = "false" },
    { name = "CONFIG_FILE_PATH", value = "config/config.json" },
    { name = "METRICS_ENABLED", value = "true" },
    { name = "METRICS_PORT", value = "8081" },
    { name = "LOG_FORMAT", value = "json" },
    { name = "LOG_LEVEL", value = var.log_level },
    { name = "REDIS_URL", value = "redis://${google_redis_instance.this.host}:${google_redis_instance.this.port}" },
    { name = "TRANSACTION_EXPIRATION_HOURS", value = "0.1" },
    { name = "REQUEST_TIMEOUT_SECONDS", value = "60" },
    { name = "PLUGIN_POOL_REQUEST_TIMEOUT_SECS", value = "60" },
    { name = "RATE_LIMIT_REQUESTS_PER_SECOND", value = local.is_prod ? "200" : "400" },
    { name = "RATE_LIMIT_BURST", value = local.is_prod ? "200" : "500" },
    { name = "MAX_CONNECTIONS", value = local.is_prod ? "1000" : "4000" },
    { name = "RELAYER_CONCURRENCY_LIMIT", value = local.is_prod ? "400" : "800" },
    { name = "PLUGIN_MAX_CONCURRENCY", value = local.is_prod ? "1000" : "4000" },
  ]

  managed_environment_secrets = concat(
    [
      { name = "API_KEY", value = var.relayer_api_key },
      { name = "KEYSTORE_JSON", value = var.keystore_json },
      { name = "KEYSTORE_PASSPHRASE", value = var.keystore_passphrase },
      { name = "CHANNELS_API_KEY", value = var.channels_api_key },
    ],
    var.storage_encryption_key != "" ? [
      { name = "STORAGE_ENCRYPTION_KEY", value = var.storage_encryption_key },
    ] : [],
  )

  user_env_keys = { for e in var.container_environment : e.name => true }
  final_environment = concat(
    [for e in local.managed_environment : e if !lookup(local.user_env_keys, e.name, false)],
    local.managed_environment_secrets,
    var.container_environment,
  )
}

# ---------------------------------------------------------------------------
# Cloud Run Service (v2)
#
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "this" {
  project  = var.project_id
  name     = "${local.app_name}-service"
  location = var.region
  ingress  = local.is_prod ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"

  deletion_protection = local.lb_deletion_protection_effective

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = local.min_instance_count_effective
      max_instance_count = local.max_instance_count_effective
    }

    vpc_access {
      connector = google_vpc_access_connector.this.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.container_image
      name  = local.app_name

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = !local.cpu_always_allocated_effective
      }

      dynamic "ports" {
        for_each = [var.container_port]
        content {
          container_port = ports.value
          name           = "http1"
        }
      }

      dynamic "env" {
        for_each = local.final_environment
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      startup_probe {
        http_get {
          path = var.health_check_path
          port = var.container_port
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        timeout_seconds       = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = var.health_check_path
          port = var.container_port
        }
        period_seconds    = 30
        timeout_seconds   = 10
        failure_threshold = 3
      }
    }

    labels = local.labels
  }

  labels = local.labels

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_iam_member.cloud_run_access,
  ]
}

# ---------------------------------------------------------------------------
# IAM: Allow unauthenticated access via the load balancer
#
# The service is fronted by an HTTPS LB; Cloud Run ingress is restricted
# to internal + LB traffic in prod, so this binding is safe.
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------
# Additional IAM for the Cloud Run service account
# ---------------------------------------------------------------------------

# Monitoring: write custom metrics
resource "google_project_iam_member" "cloud_run_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Logging: write logs
resource "google_project_iam_member" "cloud_run_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}
