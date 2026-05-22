provider "aws" {
  region = var.aws_region

  dynamic "assume_role" {
    for_each = var.aws_assume_role_arn != "" ? [var.aws_assume_role_arn] : []
    content {
      role_arn = assume_role.value
    }
  }
}

# Configure cross-account assume-role for Route53 if dns_account_role_arn is set.
provider "aws" {
  alias  = "dns"
  region = var.aws_region

  dynamic "assume_role" {
    for_each = var.dns_account_role_arn != "" ? [var.dns_account_role_arn] : []
    content {
      role_arn = assume_role.value
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Look up the Route53 zone dynamically when route53_zone_name is provided.
data "aws_route53_zone" "this" {
  count    = var.route53_zone_id == "" && var.route53_zone_name != "" ? 1 : 0
  provider = aws.dns
  name     = "${var.route53_zone_name}."
}

locals {
  route53_zone_id = coalesce(
    var.route53_zone_id,
    try(data.aws_route53_zone.this[0].zone_id, ""),
  )
}

module "relayer_channels" {
  source = "./modules/relayer-channels"

  providers = {
    aws        = aws
    aws.dns    = aws.dns
    cloudflare = cloudflare
  }

  # Core
  app_name                = var.app_name
  environment             = var.environment
  name_suffix_environment = var.name_suffix_environment

  # Networking
  vpc_id                       = var.vpc_id
  vpc_cidr                     = var.vpc_cidr
  public_subnet_ids            = var.public_subnet_ids
  alb_allowed_ipv4_cidrs       = var.alb_allowed_ipv4_cidrs
  alb_allowed_ipv6_cidrs       = var.alb_allowed_ipv6_cidrs
  additional_alb_ingress_cidrs = var.additional_alb_ingress_cidrs

  # DNS & TLS
  domain_name         = var.domain_name
  route53_zone_id     = local.route53_zone_id
  acm_certificate_arn = var.acm_certificate_arn

  # Cloudflare (optional)
  enable_cloudflare      = var.enable_cloudflare
  cloudflare_zone_id     = var.cloudflare_zone_id
  cloudflare_account_id  = var.cloudflare_account_id
  relayer_static_api_key = var.relayer_static_api_key
  key_salt               = var.key_salt
  cf_analytics_api_token = var.cf_analytics_api_token
  gen_ip_rate_hour       = var.gen_ip_rate_hour
  relay_rpm_per_key      = var.relay_rpm_per_key

  # Container / ECS
  container_image          = var.container_image
  container_image_tag      = var.container_image_tag
  container_port           = var.container_port
  cpu                      = var.cpu
  memory                   = var.memory
  desired_count            = var.desired_count
  autoscaling_min_capacity = var.autoscaling_min_capacity
  autoscaling_max_capacity = var.autoscaling_max_capacity
  cpu_architecture         = var.cpu_architecture
  ephemeral_storage_gib    = var.ephemeral_storage_gib
  health_check_path        = var.health_check_path
  container_environment    = var.container_environment
  container_secrets        = var.container_secrets

  # Relayer application
  stellar_network          = var.stellar_network
  fund_relayer_id          = var.fund_relayer_id
  allowed_fund_relayer_ids = var.allowed_fund_relayer_ids
  distributed_mode         = var.distributed_mode
  log_level                = var.log_level

  # Secrets
  relayer_api_key        = var.relayer_api_key
  channels_admin_secret  = var.channels_admin_secret
  webhook_signing_key    = var.webhook_signing_key
  storage_encryption_key = var.storage_encryption_key

  # Redis
  redis_node_type               = var.redis_node_type
  redis_num_cache_clusters      = var.redis_num_cache_clusters
  redis_engine_version          = var.redis_engine_version
  redis_snapshot_retention_days = var.redis_snapshot_retention_days

  # SQS
  sqs_queue_prefix = var.sqs_queue_prefix

  # Lambda
  enable_balance_check_lambda    = var.enable_balance_check_lambda
  balance_check_schedule         = var.balance_check_schedule
  balance_check_extra_urls       = var.balance_check_extra_urls
  enable_restart_on_alarm_lambda = var.enable_restart_on_alarm_lambda

  # CloudWatch exporter
  enable_cloudwatch_exporter   = var.enable_cloudwatch_exporter
  cloudwatch_exporter_image    = var.cloudwatch_exporter_image
  cloudwatch_metrics_namespace = var.cloudwatch_metrics_namespace

  # Observability
  log_retention_days      = var.log_retention_days
  task_log_retention_days = var.task_log_retention_days
  enable_prometheus       = var.enable_prometheus

  # ALB
  alb_deletion_protection = var.alb_deletion_protection
  alb_access_logs_bucket  = var.alb_access_logs_bucket
  alb_access_logs_prefix  = var.alb_access_logs_prefix

  # Tags
  tags = var.tags
}
