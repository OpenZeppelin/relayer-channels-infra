# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------
data "google_project" "current" {
  project_id = var.project_id
}

data "cloudflare_ip_ranges" "this" {
  count = var.enable_cloudflare ? 1 : 0
}

# ---------------------------------------------------------------------------
# Locals
# ---------------------------------------------------------------------------
locals {
  is_prod  = var.environment == "prod"
  app_name = (var.name_suffix_environment && !local.is_prod) ? "${var.app_name}-${var.environment}" : var.app_name

  project_id     = var.project_id
  project_number = data.google_project.current.number
  region         = var.region

  container_port = var.container_port

  min_instance_count_effective     = var.min_instance_count != null ? var.min_instance_count : (local.is_prod ? 2 : 1)
  max_instance_count_effective     = var.max_instance_count != null ? var.max_instance_count : (local.is_prod ? 10 : 4)
  cpu_always_allocated_effective   = var.cpu_always_allocated != null ? var.cpu_always_allocated : local.is_prod
  redis_tier_effective             = var.redis_tier != null ? var.redis_tier : (local.is_prod ? "STANDARD_HA" : "BASIC")
  redis_memory_size_effective      = var.redis_memory_size_gb != null ? var.redis_memory_size_gb : (local.is_prod ? 5 : 1)
  lb_deletion_protection_effective = var.lb_deletion_protection != null ? var.lb_deletion_protection : local.is_prod
  log_retention_effective          = var.log_retention_days != null ? var.log_retention_days : (local.is_prod ? 30 : 7)

  # Pub/Sub prefix
  pubsub_topic_prefix = var.pubsub_topic_prefix != "" ? var.pubsub_topic_prefix : "relayer-${var.stellar_network}-${var.environment}"

  # DNS project
  dns_project_id = var.dns_project_id != "" ? var.dns_project_id : var.project_id

  labels = merge(var.labels, {
    app         = local.app_name
    environment = var.environment
    managed-by  = "terraform"
  })
}

# ---------------------------------------------------------------------------
# Enable required APIs
# ---------------------------------------------------------------------------
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "redis.googleapis.com",
    "pubsub.googleapis.com",
    "vpcaccess.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudfunctions.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "certificatemanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "cloudkms.googleapis.com",
    "artifactregistry.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------
check "cloudflare_inputs" {
  assert {
    condition     = !var.enable_cloudflare || var.cloudflare_zone_id != ""
    error_message = "cloudflare_zone_id is required when enable_cloudflare is true."
  }
}

check "cloudflare_account_id" {
  assert {
    condition     = !var.enable_cloudflare || var.cloudflare_account_id != ""
    error_message = "cloudflare_account_id is required when enable_cloudflare is true."
  }
}

check "cloudflare_secrets" {
  assert {
    condition     = !var.enable_cloudflare || (var.relayer_static_api_key != "" && var.key_salt != "")
    error_message = "relayer_static_api_key and key_salt are required when enable_cloudflare is true."
  }
}
