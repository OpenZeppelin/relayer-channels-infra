# ---------------------------------------------------------------------------
# Provider configuration
# ---------------------------------------------------------------------------
variable "aws_region" {
  type        = string
  description = "AWS region for all resources"
}

variable "cloudflare_api_token" {
  type        = string
  description = "Cloudflare API token. Required only when enable_cloudflare is true; otherwise pass an empty string."
  sensitive   = true
  default     = ""
}

variable "aws_assume_role_arn" {
  type        = string
  description = "IAM role ARN to assume for resource creation (leave empty to use current credentials)"
  default     = ""
}

variable "dns_account_role_arn" {
  type        = string
  description = "IAM role ARN to assume for Route53 DNS operations (leave empty if same account)"
  default     = ""
}

# ---------------------------------------------------------------------------
# Module inputs (passed through to modules/relayer-channels)
# ---------------------------------------------------------------------------
variable "app_name" {
  type        = string
  description = "Application name prefix for all resources"
  default     = "relayer-channels"
}

variable "environment" {
  type        = string
  description = "Deployment environment (e.g. 'prod', 'stg')"
}

variable "name_suffix_environment" {
  type    = bool
  default = true
}

# Networking
variable "vpc_id" {
  type        = string
  description = "VPC ID where resources will be deployed"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR block"
  default     = ""
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for ALB and ECS tasks"
}

variable "alb_allowed_ipv4_cidrs" {
  type    = list(string)
  default = []
}

variable "alb_allowed_ipv6_cidrs" {
  type    = list(string)
  default = []
}

variable "additional_alb_ingress_cidrs" {
  type    = list(string)
  default = []
}

# DNS & TLS
variable "domain_name" {
  type        = string
  description = "Fully qualified domain name for the service"
}

variable "route53_zone_id" {
  type        = string
  description = "Route53 hosted zone ID. If empty, route53_zone_name is used for lookup."
  default     = ""
}

variable "route53_zone_name" {
  type        = string
  description = "Route53 zone name for dynamic lookup (e.g. 'example.com'). Ignored if route53_zone_id is set."
  default     = ""
}

variable "acm_certificate_arn" {
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

# Container / ECS
variable "container_image" {
  type    = string
  default = ""
}

variable "container_image_tag" {
  type    = string
  default = "latest"
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "cpu" {
  type    = number
  default = 1024
}

variable "memory" {
  type    = number
  default = 2048
}

variable "desired_count" {
  type    = number
  default = null
}

variable "autoscaling_min_capacity" {
  type    = number
  default = null
}

variable "autoscaling_max_capacity" {
  type    = number
  default = null
}

variable "cpu_architecture" {
  type    = string
  default = "X86_64"
}

variable "ephemeral_storage_gib" {
  type    = number
  default = 50
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

variable "container_secrets" {
  type = list(object({
    name      = string
    valueFrom = string
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

# Redis
variable "redis_node_type" {
  type    = string
  default = null
}

variable "redis_num_cache_clusters" {
  type    = number
  default = null
}

variable "redis_engine_version" {
  type    = string
  default = "7.1"
}

variable "redis_snapshot_retention_days" {
  type    = number
  default = 7
}

# SQS
variable "sqs_queue_prefix" {
  type    = string
  default = ""
}

# Lambda
variable "enable_balance_check_lambda" {
  type    = bool
  default = false
}

variable "balance_check_schedule" {
  type    = string
  default = "rate(5 minutes)"
}

variable "balance_check_extra_urls" {
  type    = string
  default = ""
}

variable "enable_restart_on_alarm_lambda" {
  type    = bool
  default = false
}

# CloudWatch exporter
variable "enable_cloudwatch_exporter" {
  type    = bool
  default = false
}

variable "cloudwatch_exporter_image" {
  type    = string
  default = ""
}

variable "cloudwatch_metrics_namespace" {
  type    = string
  default = "RelayerChannelsTransactions"
}

# Observability
variable "log_retention_days" {
  type    = number
  default = null
}

variable "task_log_retention_days" {
  type    = number
  default = null
}

variable "enable_prometheus" {
  type    = bool
  default = true
}

# ALB
variable "alb_deletion_protection" {
  type    = bool
  default = null
}

variable "alb_access_logs_bucket" {
  type    = string
  default = ""
}

variable "alb_access_logs_prefix" {
  type    = string
  default = "access"
}

# Tags
variable "tags" {
  type    = map(string)
  default = {}
}
