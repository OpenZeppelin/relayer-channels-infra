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
# Networking
# ---------------------------------------------------------------------------
variable "vpc_id" {
  type        = string
  description = "VPC ID where resources will be deployed"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block (used for ALB egress rules). Required when creating a standalone ALB."
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
  description = "Fully qualified domain name for the service (e.g. 'x402.example.com')"
  default     = ""
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for DNS records"
  default     = ""
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
  description = "Enable Cloudflare DNS proxy in front of the ALB"
  default     = false
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare zone ID. Required when enable_cloudflare is true."
  default     = ""
}

# ---------------------------------------------------------------------------
# Container / ECS
# ---------------------------------------------------------------------------
variable "container_image" {
  type        = string
  description = "Container image URI for the x402 facilitator (e.g. 'public.ecr.aws/abc/x402:latest'). If empty, an ECR repository is created."
  default     = ""
}

variable "container_image_tag" {
  type        = string
  description = "Container image tag (used when container_image is empty and ECR is created)"
  default     = "latest"
}

variable "container_port" {
  type        = number
  description = "Container port the x402 facilitator listens on"
  default     = 8080
}

variable "cpu" {
  type        = number
  description = "ECS task CPU units (1 vCPU = 1024)"
  default     = 512
}

variable "memory" {
  type        = number
  description = "ECS task memory in MiB"
  default     = 1024
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

variable "health_check_path" {
  type        = string
  description = "HTTP path for container and ALB health checks"
  default     = "/"
}

variable "container_environment" {
  type = list(object({
    name  = string
    value = string
  }))
  description = "Additional environment variables for the x402 container. These are merged with module-managed variables; user values take precedence."
  default     = []
}

variable "container_secrets" {
  type = list(object({
    name      = string
    valueFrom = string
  }))
  description = "SSM/Secrets Manager references injected as container secrets. These are merged with module-managed secrets. Use this to inject network-specific CHANNELS_API_KEY secrets."
  default     = []
}

# ---------------------------------------------------------------------------
# Shared ALB (optional — use existing ALB instead of creating one)
# ---------------------------------------------------------------------------
variable "existing_alb_listener_arn" {
  type        = string
  description = "ARN of an existing ALB HTTPS listener. When set, the module creates a listener rule and target group instead of a full ALB."
  default     = ""
}

variable "existing_alb_security_group_id" {
  type        = string
  description = "Security group ID of the existing ALB. Required when existing_alb_listener_arn is set."
  default     = ""
}

variable "listener_rule_path_patterns" {
  type        = list(string)
  description = "Path patterns for the ALB listener rule (shared ALB mode)"
  default     = ["/api/v1/plugins/x402/call", "/api/v1/plugins/x402/call/*"]
}

variable "listener_rule_priority" {
  type        = number
  description = "Priority for the ALB listener rule (shared ALB mode)"
  default     = 5
}

# ---------------------------------------------------------------------------
# Existing ECS cluster (optional)
# ---------------------------------------------------------------------------
variable "existing_ecs_cluster_arn" {
  type        = string
  description = "ARN of an existing ECS cluster. When set, no new cluster is created."
  default     = ""
}

# ---------------------------------------------------------------------------
# Application configuration
# ---------------------------------------------------------------------------
variable "log_level" {
  type        = string
  description = "Application log level. Defaults to 'warn' for prod, 'info' otherwise."
  default     = null
}

# ---------------------------------------------------------------------------
# Secrets (stored in SSM Parameter Store)
# ---------------------------------------------------------------------------
variable "relayer_api_key" {
  type        = string
  description = "Relayer API key stored in SSM Parameter Store"
  sensitive   = true
}

variable "keystore_json" {
  type        = string
  description = "Keystore JSON stored in SSM Parameter Store"
  sensitive   = true
}

variable "keystore_passphrase" {
  type        = string
  description = "Keystore passphrase stored in SSM Parameter Store"
  sensitive   = true
}

variable "storage_encryption_key" {
  type        = string
  description = "Storage encryption key stored in SSM Parameter Store (base64-encoded)"
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------------------
# Redis (ElastiCache)
# ---------------------------------------------------------------------------
variable "redis_node_type" {
  type        = string
  description = "ElastiCache node type. Defaults to cache.t4g.micro."
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
# CloudWatch Exporter sidecar (optional)
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
  default     = "X402FacilitatorTransactions"
}

# ---------------------------------------------------------------------------
# Monitoring
# ---------------------------------------------------------------------------
variable "enable_monitoring" {
  type        = bool
  description = "Enable CloudWatch alarms and SNS topic. Defaults to true for prod, false otherwise."
  default     = null
}

variable "sns_topic_name" {
  type        = string
  description = "SNS topic name for alarm notifications. Defaults to '<app_name>-alarms'."
  default     = ""
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

# ---------------------------------------------------------------------------
# ALB (standalone mode)
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
