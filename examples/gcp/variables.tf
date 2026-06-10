# ---------------------------------------------------------------------------
# GCP Provider
# ---------------------------------------------------------------------------
variable "project_id" {
  type        = string
  description = "GCP project ID where resources will be deployed"
}

variable "region" {
  type        = string
  description = "GCP region for all resources"
}

variable "cloudflare_api_token" {
  type        = string
  description = "Cloudflare API token. Required only when enable_cloudflare is true."
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# Module inputs (passed through to modules/gcp)
# ---------------------------------------------------------------------------
variable "app_name" {
  type    = string
  default = "relayer-channels"
}

variable "environment" {
  type = string
}

variable "name_suffix_environment" {
  type    = bool
  default = true
}

# Networking
variable "network" {
  type        = string
  description = "VPC network name or self_link"
}

variable "subnetwork" {
  type        = string
  description = "Subnet name or self_link"
}

variable "connector_ip_cidr_range" {
  type    = string
  default = "10.8.0.0/28"
}

# DNS & TLS
variable "domain_name" {
  type = string
}

variable "dns_managed_zone_name" {
  type    = string
  default = ""
}

variable "dns_project_id" {
  type    = string
  default = ""
}

# Cloudflare (optional)
variable "enable_cloudflare" {
  type    = bool
  default = false
}

variable "cloudflare_zone_id" {
  type    = string
  default = ""
}

variable "cloudflare_account_id" {
  type    = string
  default = ""
}

variable "relayer_static_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "key_salt" {
  type      = string
  sensitive = true
  default   = ""
}

variable "cf_analytics_api_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "gen_ip_rate_hour" {
  type    = number
  default = 2
}

variable "relay_rpm_per_key" {
  type    = number
  default = 60
}

# Container / Cloud Run
variable "container_image" {
  type = string
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "2Gi"
}

variable "min_instance_count" {
  type    = number
  default = null
}

variable "max_instance_count" {
  type    = number
  default = null
}

variable "health_check_path" {
  type    = string
  default = "/api/v1/health"
}

variable "container_environment" {
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

# Relayer application
variable "stellar_network" {
  type    = string
  default = "testnet"
}

variable "fund_relayer_id" {
  type    = string
  default = "channels-fund"
}

variable "allowed_fund_relayer_ids" {
  type    = string
  default = ""
}

variable "distributed_mode" {
  type    = bool
  default = true
}

variable "queue_backend" {
  type        = string
  description = "Queue backend: 'sqs' (requires AWS creds), 'redis', or 'pubsub'"
  default     = "sqs"
}

variable "sqs_queue_url_prefix" {
  type        = string
  description = "SQS queue URL prefix. Required when queue_backend is 'sqs'."
  default     = ""
}

variable "log_level" {
  type    = string
  default = "warn"
}

# Secrets
variable "relayer_api_key" {
  type      = string
  sensitive = true
}

variable "channels_admin_secret" {
  type      = string
  sensitive = true
}

variable "webhook_signing_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "storage_encryption_key" {
  type      = string
  sensitive = true
  default   = ""
}

# Redis (Memorystore)
variable "redis_tier" {
  type    = string
  default = null
}

variable "redis_memory_size_gb" {
  type    = number
  default = null
}

variable "redis_version" {
  type    = string
  default = "REDIS_7_2"
}

# Pub/Sub
variable "pubsub_topic_prefix" {
  type    = string
  default = ""
}

# Cloud Functions
variable "enable_balance_check_function" {
  type    = bool
  default = false
}

variable "balance_check_schedule" {
  type    = string
  default = "*/5 * * * *"
}

variable "balance_check_extra_urls" {
  type    = string
  default = ""
}


# Observability
variable "log_retention_days" {
  type    = number
  default = null
}

variable "enable_prometheus" {
  type    = bool
  default = true
}

# Load Balancer
variable "lb_deletion_protection" {
  type    = bool
  default = null
}

# Labels
variable "labels" {
  type    = map(string)
  default = {}
}
