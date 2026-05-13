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
# Networking
# ---------------------------------------------------------------------------
variable "vpc_id" {
  type        = string
  description = "VPC ID where resources will be deployed"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block (used for ALB egress rules). Required when private_subnet_ids is empty."
  default     = ""
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for ALB and ECS tasks (must span at least 2 AZs)"
}

variable "alb_allowed_ipv4_cidrs" {
  type        = list(string)
  description = "IPv4 CIDRs allowed to reach the ALB on port 443. When empty and enable_cloudflare is true, Cloudflare IP ranges are used."
  default     = []
}

variable "alb_allowed_ipv6_cidrs" {
  type        = list(string)
  description = "IPv6 CIDRs allowed to reach the ALB on port 443. When empty and enable_cloudflare is true, Cloudflare IPv6 ranges are used."
  default     = []
}

variable "additional_alb_ingress_cidrs" {
  type        = list(string)
  description = "Additional IPv4 CIDRs to allow direct access to the ALB (e.g. VPN IP ranges)"
  default     = []
}

# ---------------------------------------------------------------------------
# DNS & TLS
# ---------------------------------------------------------------------------
variable "domain_name" {
  type        = string
  description = "Fully qualified domain name for the service (e.g. 'channels.example.com')"
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for DNS records"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener. If empty, a new certificate is created and validated via Route53."
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
# Container / ECS
# ---------------------------------------------------------------------------
variable "container_image" {
  type        = string
  description = "Container image URI for the relayer (e.g. 'public.ecr.aws/abc/relayer:latest'). If empty, an ECR repository is created."
  default     = ""
}

variable "container_image_tag" {
  type        = string
  description = "Container image tag (used when container_image is empty and ECR is created)"
  default     = "latest"
}

variable "container_port" {
  type        = number
  description = "Container port the relayer listens on"
  default     = 8080
}

variable "cpu" {
  type        = number
  description = "ECS task CPU units (1 vCPU = 1024)"
  default     = 1024
}

variable "memory" {
  type        = number
  description = "ECS task memory in MiB"
  default     = 2048
}

variable "desired_count" {
  type        = number
  description = "Desired number of ECS tasks. Defaults to 2 for prod, 1 otherwise."
  default     = null
}

variable "autoscaling_min_capacity" {
  type        = number
  description = "Minimum number of ECS tasks for autoscaling. Defaults to desired_count."
  default     = null
}

variable "autoscaling_max_capacity" {
  type        = number
  description = "Maximum number of ECS tasks for autoscaling. Defaults to 10 for prod, 4 otherwise."
  default     = null
}

variable "cpu_architecture" {
  type        = string
  description = "CPU architecture for ECS tasks"
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "ephemeral_storage_gib" {
  type        = number
  description = "Ephemeral storage size in GiB for ECS tasks"
  default     = 50
}

variable "health_check_path" {
  type        = string
  description = "HTTP path for container and ALB health checks"
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

variable "container_secrets" {
  type = list(object({
    name      = string
    valueFrom = string
  }))
  description = "SSM/Secrets Manager references injected as container secrets. These are merged with module-managed secrets."
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
  description = "Enable distributed mode (SQS-backed queue processing)"
  default     = true
}

variable "log_level" {
  type        = string
  description = "Application log level"
  default     = "warn"
}

# ---------------------------------------------------------------------------
# Secrets (stored in SSM Parameter Store)
# ---------------------------------------------------------------------------
variable "relayer_api_key" {
  type        = string
  description = "Relayer API key stored in SSM Parameter Store and used for authenticated requests"
  sensitive   = true
}

variable "channels_admin_secret" {
  type        = string
  description = "Channels plugin admin secret stored in SSM Parameter Store"
  sensitive   = true
}

variable "webhook_signing_key" {
  type        = string
  description = "Webhook signing key stored in SSM Parameter Store"
  sensitive   = true
  default     = ""
}

variable "storage_encryption_key" {
  type        = string
  description = "Storage encryption key stored in SSM Parameter Store"
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# Redis (ElastiCache)
# ---------------------------------------------------------------------------
variable "redis_node_type" {
  type        = string
  description = "ElastiCache node type. Defaults to cache.r7g.large for prod, cache.t4g.medium otherwise."
  default     = null
}

variable "redis_num_cache_clusters" {
  type        = number
  description = "Number of cache clusters (nodes) in the Redis replication group. Set to 2+ for failover."
  default     = null
}

variable "redis_engine_version" {
  type        = string
  description = "Redis engine version"
  default     = "7.1"
}

variable "redis_snapshot_retention_days" {
  type        = number
  description = "Number of days to retain Redis snapshots. 0 disables snapshots."
  default     = 7
}

# ---------------------------------------------------------------------------
# SQS
# ---------------------------------------------------------------------------
variable "sqs_queue_prefix" {
  type        = string
  description = "Prefix for SQS queue names"
  default     = ""
}

# ---------------------------------------------------------------------------
# Lambda (optional monitoring)
# ---------------------------------------------------------------------------
variable "enable_balance_check_lambda" {
  type        = bool
  description = "Deploy a Lambda function that periodically checks relayer balance and publishes CloudWatch metrics"
  default     = false
}

variable "balance_check_schedule" {
  type        = string
  description = "EventBridge schedule expression for the balance check Lambda"
  default     = "rate(5 minutes)"
}

variable "balance_check_extra_urls" {
  type        = string
  description = "Comma-separated list of 'relayerId=balanceUrl' pairs for additional balance checks"
  default     = ""
}

variable "enable_restart_on_alarm_lambda" {
  type        = bool
  description = "Deploy a Lambda function that forces ECS redeployment when triggered by a CloudWatch alarm"
  default     = false
}

# ---------------------------------------------------------------------------
# Cloudwatch Exporter sidecar (optional)
# ---------------------------------------------------------------------------
variable "enable_cloudwatch_exporter" {
  type        = bool
  description = "Enable the CloudWatch metrics exporter sidecar container"
  default     = false
}

variable "cloudwatch_exporter_image" {
  type        = string
  description = "Container image for the CloudWatch exporter sidecar"
  default     = ""
}

variable "cloudwatch_metrics_namespace" {
  type        = string
  description = "CloudWatch namespace for the exporter sidecar metrics"
  default     = "RelayerChannelsTransactions"
}

# ---------------------------------------------------------------------------
# Observability
# ---------------------------------------------------------------------------
variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days. Defaults to 30 for prod, 7 otherwise."
  default     = null
}

variable "task_log_retention_days" {
  type        = number
  description = "CloudWatch task log retention in days. Defaults to 365 for prod, 7 otherwise."
  default     = null
}

variable "enable_prometheus" {
  type        = bool
  description = "Create an Amazon Managed Prometheus (AMP) workspace"
  default     = true
}

# ---------------------------------------------------------------------------
# ALB
# ---------------------------------------------------------------------------
variable "alb_deletion_protection" {
  type        = bool
  description = "Enable ALB deletion protection. Defaults to true for prod, false otherwise."
  default     = null
}

variable "alb_access_logs_bucket" {
  type        = string
  description = "S3 bucket name for ALB access logs. Leave empty to disable access logging."
  default     = ""
}

variable "alb_access_logs_prefix" {
  type        = string
  description = "S3 key prefix for ALB access logs"
  default     = "access"
}

# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------
variable "tags" {
  type        = map(string)
  description = "Tags applied to all resources"
  default     = {}
}
