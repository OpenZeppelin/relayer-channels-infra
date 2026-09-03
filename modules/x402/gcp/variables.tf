# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
variable "app_name" {
  type        = string
  description = "Application name prefix for all resources"
  default     = "x402-facilitator"
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
  description = "Fully qualified domain name for the service (e.g. 'x402.example.com')"
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
  description = "Enable Cloudflare DNS proxy for the load balancer IP"
  default     = false
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare zone ID. Required when enable_cloudflare is true."
  default     = ""
}

# ---------------------------------------------------------------------------
# Container / Cloud Run
# ---------------------------------------------------------------------------
variable "container_image" {
  type        = string
  description = "Container image URI for the x402 facilitator (e.g. 'us-docker.pkg.dev/project/repo/image:tag'). Required."
}

variable "container_port" {
  type        = number
  description = "Container port the facilitator listens on"
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
  description = "Additional environment variables for the facilitator container. These are merged with module-managed variables; user values take precedence."
  default     = []
}

# ---------------------------------------------------------------------------
# Secrets (stored in Secret Manager)
# ---------------------------------------------------------------------------
variable "relayer_api_key" {
  type        = string
  description = "Relayer API key stored in Secret Manager and used for authenticated requests"
  sensitive   = true
}

variable "keystore_json" {
  type        = string
  description = "Keystore JSON stored in Secret Manager (contains the signing key material)"
  sensitive   = true
}

variable "keystore_passphrase" {
  type        = string
  description = "Keystore passphrase stored in Secret Manager"
  sensitive   = true
}

variable "storage_encryption_key" {
  type        = string
  description = "Storage encryption key stored in Secret Manager (base64-encoded)"
  sensitive   = true
  default     = ""
}

variable "channels_api_key" {
  type        = string
  description = "Channels API key stored in Secret Manager for authenticating with the Channels relayer"
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------
variable "log_level" {
  type        = string
  description = "Application log level"
  default     = "warn"
}

variable "log_retention_days" {
  type        = number
  description = "Cloud Logging log bucket retention in days. Defaults to 30 for prod, 7 otherwise."
  default     = null
}

# ---------------------------------------------------------------------------
# Redis (Memorystore)
# ---------------------------------------------------------------------------
variable "redis_tier" {
  type        = string
  description = "Memorystore Redis tier. Defaults to BASIC (x402 has low state needs)."
  default     = null
  nullable    = true

  validation {
    condition     = var.redis_tier == null || try(contains(["BASIC", "STANDARD_HA"], var.redis_tier), false)
    error_message = "redis_tier must be 'BASIC' or 'STANDARD_HA'."
  }
}

variable "redis_memory_size_gb" {
  type        = number
  description = "Memorystore Redis memory in GB. Defaults to 1."
  default     = null
}

variable "redis_version" {
  type        = string
  description = "Memorystore Redis version"
  default     = "REDIS_7_2"
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

variable "lb_timeout_sec" {
  type        = number
  description = "Backend service timeout in seconds"
  default     = 60
}

# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------
variable "labels" {
  type        = map(string)
  description = "Labels applied to all resources"
  default     = {}
}
