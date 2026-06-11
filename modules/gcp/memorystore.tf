# ---------------------------------------------------------------------------
# Memorystore for Redis
#
# STANDARD_HA provides automatic failover with a replica in a different zone.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Private Service Access (required for Memorystore)
#
# Allocates an IP range in the VPC and creates a peering connection to
# Google's service networking so Memorystore can attach privately.
# ---------------------------------------------------------------------------
resource "google_compute_global_address" "private_service_range" {
  project       = var.project_id
  name          = "${local.app_name}-private-svc-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 24
  network       = var.network

  depends_on = [google_project_service.apis["servicenetworking.googleapis.com"]]
}

resource "google_service_networking_connection" "private_service" {
  network                 = var.network
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]

  update_on_creation_fail = true

  depends_on = [google_project_service.apis["servicenetworking.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Redis Instance
# ---------------------------------------------------------------------------
resource "google_redis_instance" "this" {
  project        = var.project_id
  name           = "${local.app_name}-redis"
  display_name   = "Redis for ${local.app_name}"
  region         = var.region
  tier           = local.redis_tier_effective
  memory_size_gb = local.redis_memory_size_effective
  redis_version  = var.redis_version

  authorized_network = var.network

  transit_encryption_mode = "DISABLED"
  connect_mode            = "PRIVATE_SERVICE_ACCESS"

  maintenance_policy {
    weekly_maintenance_window {
      day = "SATURDAY"
      start_time {
        hours   = 0
        minutes = 0
      }
    }
  }

  redis_configs = {
    databases = "10"
  }

  labels = local.labels

  depends_on = [
    google_project_service.apis["redis.googleapis.com"],
    google_service_networking_connection.private_service,
  ]
}
