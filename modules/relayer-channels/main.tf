# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "cloudflare_ip_ranges" "this" {
  count = var.enable_cloudflare && length(var.alb_allowed_ipv4_cidrs) == 0 ? 1 : 0
}

# ---------------------------------------------------------------------------
# Locals
# ---------------------------------------------------------------------------
locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name

  is_prod  = var.environment == "prod"
  app_name = (var.name_suffix_environment && !local.is_prod) ? "${var.app_name}-${var.environment}" : var.app_name

  container_port = var.container_port

  # Smart defaults based on environment
  desired_count_effective           = var.desired_count != null ? var.desired_count : (local.is_prod ? 2 : 1)
  autoscaling_min_effective         = var.autoscaling_min_capacity != null ? var.autoscaling_min_capacity : local.desired_count_effective
  autoscaling_max_effective         = var.autoscaling_max_capacity != null ? var.autoscaling_max_capacity : (local.is_prod ? 10 : 4)
  redis_node_type_effective         = var.redis_node_type != null ? var.redis_node_type : (local.is_prod ? "cache.r7g.large" : "cache.t4g.medium")
  redis_num_clusters_effective      = var.redis_num_cache_clusters != null ? var.redis_num_cache_clusters : (local.is_prod ? 2 : 1)
  alb_deletion_protection_effective = var.alb_deletion_protection != null ? var.alb_deletion_protection : local.is_prod
  log_retention_effective           = var.log_retention_days != null ? var.log_retention_days : (local.is_prod ? 30 : 7)
  task_log_retention_effective      = var.task_log_retention_days != null ? var.task_log_retention_days : (local.is_prod ? 365 : 7)

  # Container image: use provided or fallback to ECR
  manage_ecr      = var.container_image == ""
  container_image = local.manage_ecr ? "${aws_ecrpublic_repository.this[0].repository_uri}:${var.container_image_tag}" : var.container_image

  # SQS prefix
  sqs_queue_prefix = var.sqs_queue_prefix != "" ? var.sqs_queue_prefix : "relayer-${var.stellar_network}-${var.environment}"

  # ALB ingress CIDRs
  cf_ipv4_cidrs = try(data.cloudflare_ip_ranges.this[0].ipv4_cidrs, [])
  alb_ipv4_cidrs = length(var.alb_allowed_ipv4_cidrs) > 0 ? var.alb_allowed_ipv4_cidrs : (
    var.enable_cloudflare ? local.cf_ipv4_cidrs : ["0.0.0.0/0"]
  )
  all_alb_ipv4_cidrs = concat(local.alb_ipv4_cidrs, var.additional_alb_ingress_cidrs)

  # SSM parameter paths
  ssm_prefix = "/${local.app_name}"

  tags = merge(var.tags, {
    Name        = local.app_name
    Environment = var.environment
  })
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

check "vpc_cidr_input" {
  assert {
    condition     = var.vpc_cidr != ""
    error_message = "vpc_cidr is required for ALB egress security group rules."
  }
}
