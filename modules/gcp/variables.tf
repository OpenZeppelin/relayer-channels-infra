# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
variable "app_name" {
  type        = string
  description = "Application name prefix for all resources"
  default     = "relayer-channels"
}

variable "environment" {
  type        = string
  description = "Deployment environment (e.g. 'prod', 'stg')"

  validation {
    condition     = length(var.environment) > 0 && length(var.environment) <= 16
    error_message = "environment must be 1-16 characters."
  }
}

variable "name_suffix_environment" {
  type        = bool
  description = "Append '-<environment>' to resource names (disabled for prod)"
  default     = true
}

# ---------------------------------------------------------------------------
# GCP Provider
# ---------------------------------------------------------------------------
variable "project_id" {
  type        = string
  description = "GCP project ID where resources will be deployed"
}

variable "region" {
  type        = string
  description = "GCP region for all resources (e.g. 'us-central1')"
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------
variable "network" {
  type        = string
  description = "VPC network name or self_link for Memorystore and VPC connector"
}

variable "subnetwork" {
  type        = string
  description = "Subnet name or self_link for the VPC connector"
}

variable "connector_machine_type" {
  type        = string
  description = "Machine type for the Serverless VPC Access connector"
  default     = "e2-micro"
}

variable "connector_min_instances" {
  type        = number
  description = "Minimum instances for the VPC Access connector"
  default     = 2
}

variable "connector_max_instances" {
  type        = number
  description = "Maximum instances for the VPC Access connector"
  default     = 3
}

variable "connector_ip_cidr_range" {
  type        = string
  description = "CIDR range for the Serverless VPC Access connector (must be /28 and not overlap with existing subnets)"
  default     = "10.8.0.0/28"
}

# ---------------------------------------------------------------------------
# DNS & TLS
# ---------------------------------------------------------------------------
variable "domain_name" {
  type        = string
  description = "Fully qualified domain name for the service (e.g. 'channels.example.com')"
}

variable "dns_managed_zone_name" {
  type        = string
  description = "Cloud DNS managed zone name for DNS records. Leave empty to skip Cloud DNS record creation."
  default     = ""
}

variable "dns_project_id" {
  type        = string
  description = "GCP project ID where Cloud DNS zone lives (leave empty if same as project_id)"
  default     = ""
}

# ---------------------------------------------------------------------------
# Cloudflare (optional)
# ---------------------------------------------------------------------------
variable "enable_cloudflare" {
  type        = bool
  description = "Enable Cloudflare CDN proxy, Workers gateway, and KV-based API key management"
  default     = false
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare zone ID. Required when enable_cloudflare is true."
  default     = ""
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID. Required when enable_cloudflare is true."
  default     = ""
}

variable "relayer_static_api_key" {
  type        = string
  description = "Static upstream relayer API key injected by the Cloudflare Worker. Required when enable_cloudflare is true."
  sensitive   = true
  default     = ""
}

variable "key_salt" {
  type        = string
  description = "Salt for hashing user API keys before storing in Cloudflare KV. Required when enable_cloudflare is true."
  sensitive   = true
  default     = ""
}

variable "cf_analytics_api_token" {
  type        = string
  description = "Cloudflare API token with Account Analytics Read permission (for usage endpoint). Required when enable_cloudflare is true."
  sensitive   = true
  default     = ""
}

variable "gen_ip_rate_hour" {
  type        = number
  description = "Max POST /gen requests per IP per hour (Cloudflare Worker rate limit)"
  default     = 2
}

variable "relay_rpm_per_key" {
  type        = number
  description = "Max requests per minute per user key on relay endpoints (Cloudflare Worker rate limit)"
  default     = 60
}

# ---------------------------------------------------------------------------
# Container / Cloud Run
# ---------------------------------------------------------------------------
variable "container_image" {
  type        = string
  description = "Container image URI for the relayer (e.g. 'us-docker.pkg.dev/project/repo/image:tag'). Required."
}

variable "container_port" {
  type        = number
  description = "Container port the relayer listens on"
  default     = 8080
}

variable "cpu" {
  type        = string
  description = "Cloud Run CPU allocation (e.g. '1', '2', '4')"
  default     = "1"
}

variable "memory" {
  type        = string
  description = "Cloud Run memory allocation (e.g. '2Gi', '4Gi')"
  default     = "2Gi"
}

variable "min_instance_count" {
  type        = number
  description = "Minimum number of Cloud Run instances. Defaults to 2 for prod, 1 otherwise."
  default     = null
}

variable "max_instance_count" {
  type        = number
  description = "Maximum number of Cloud Run instances. Defaults to 10 for prod, 4 otherwise."
  default     = null
}

variable "cpu_always_allocated" {
  type        = bool
  description = "Whether CPU is always allocated (true) or only during request processing (false). Defaults to true for prod."
  default     = null
}

variable "health_check_path" {
  type        = string
  description = "HTTP path for container startup and liveness probes"
  default     = "/api/v1/health"
}

variable "container_environment" {
  type = list(object({
    name  = string
    value = string
  }))
  description = "Additional environment variables for the relayer container. These are merged with module-managed variables; user values take precedence."
  default     = []
}

# ---------------------------------------------------------------------------
# Relayer application configuration
# ---------------------------------------------------------------------------
variable "stellar_network" {
  type        = string
  description = "Stellar network to connect to"
  default     = "testnet"

  validation {
    condition     = contains(["mainnet", "testnet"], var.stellar_network)
    error_message = "stellar_network must be 'mainnet' or 'testnet'."
  }
}

variable "fund_relayer_id" {
  type        = string
  description = "Fund relayer identifier"
  default     = "channels-fund"
}

variable "allowed_fund_relayer_ids" {
  type        = string
  description = "Comma-separated list of allowed fund relayer IDs"
  default     = ""
}

variable "distributed_mode" {
  type        = bool
  description = "Enable distributed mode for the application. When true, the queue backend is used for cross-instance coordination."
  default     = true
}

variable "queue_backend" {
  type        = string
  description = "Queue backend for distributed processing. Use 'sqs' (requires AWS credentials), 'redis' (uses Memorystore — known i64 serialization issue), or 'pubsub' (requires app-side adapter). Ignored when distributed_mode is false."
  default     = "sqs"

  validation {
    condition     = contains(["sqs", "redis", "pubsub"], var.queue_backend)
    error_message = "queue_backend must be 'sqs', 'redis', or 'pubsub'."
  }
}

variable "sqs_queue_url_prefix" {
  type        = string
  description = "SQS queue URL prefix (e.g. 'https://sqs.us-east-1.amazonaws.com/123456789/relayer-testnet-stg-'). Required when queue_backend is 'sqs'."
  default     = ""
}

variable "log_level" {
  type        = string
  description = "Application log level"
  default     = "warn"
}

# ---------------------------------------------------------------------------
# Secrets (stored in Secret Manager)
# ---------------------------------------------------------------------------
variable "relayer_api_key" {
  type        = string
  description = "Relayer API key stored in Secret Manager and used for authenticated requests"
  sensitive   = true
}

variable "channels_admin_secret" {
  type        = string
  description = "Channels plugin admin secret stored in Secret Manager"
  sensitive   = true
}

variable "webhook_signing_key" {
  type        = string
  description = "Webhook signing key stored in Secret Manager"
  sensitive   = true
  default     = ""
}

variable "storage_encryption_key" {
  type        = string
  description = "Storage encryption key stored in Secret Manager"
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# Redis (Memorystore)
# ---------------------------------------------------------------------------
variable "redis_tier" {
  type        = string
  description = "Memorystore Redis tier. Defaults to STANDARD_HA for prod, BASIC otherwise."
  default     = null
  nullable    = true

  validation {
    condition     = var.redis_tier == null || try(contains(["BASIC", "STANDARD_HA"], var.redis_tier), false)
    error_message = "redis_tier must be 'BASIC' or 'STANDARD_HA'."
  }
}

variable "redis_memory_size_gb" {
  type        = number
  description = "Memorystore Redis memory in GB. Defaults to 5 for prod, 1 otherwise."
  default     = null
}

variable "redis_version" {
  type        = string
  description = "Memorystore Redis version"
  default     = "REDIS_7_2"
}

# ---------------------------------------------------------------------------
# Pub/Sub (replaces SQS)
# ---------------------------------------------------------------------------
variable "pubsub_topic_prefix" {
  type        = string
  description = "Prefix for Pub/Sub topic names"
  default     = ""
}

# ---------------------------------------------------------------------------
# Cloud Functions (optional monitoring)
# ---------------------------------------------------------------------------
variable "enable_balance_check_function" {
  type        = bool
  description = "Deploy a Cloud Function that periodically checks relayer balance and publishes metrics"
  default     = false
}

variable "balance_check_schedule" {
  type        = string
  description = "Cloud Scheduler cron expression for the balance check function (e.g. '*/5 * * * *')"
  default     = "*/5 * * * *"
}

variable "balance_check_extra_urls" {
  type        = string
  description = "Comma-separated list of 'relayerId=balanceUrl' pairs for additional balance checks"
  default     = ""
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------
variable "log_retention_days" {
  type        = number
  description = "Cloud Logging log bucket retention in days. Defaults to 30 for prod, 7 otherwise."
  default     = null
}

variable "enable_prometheus" {
  type        = bool
  description = "Enable Google Cloud Managed Prometheus metrics collection"
  default     = true
}

# ---------------------------------------------------------------------------
# Load Balancer
# ---------------------------------------------------------------------------
variable "lb_deletion_protection" {
  type        = bool
  description = "Enable load balancer deletion protection. Defaults to true for prod, false otherwise."
  default     = null
}

variable "lb_log_sample_rate" {
  type        = number
  description = "Fraction of requests to log (0.0 to 1.0). 0 disables logging."
  default     = 0
}

# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------
variable "labels" {
  type        = map(string)
  description = "Labels applied to all resources"
  default     = {}
}
