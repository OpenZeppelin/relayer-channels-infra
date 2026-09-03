# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "cloudflare_ip_ranges" "this" {
  count = var.enable_cloudflare && length(var.alb_allowed_ipv4_cidrs) == 0 && !local.shared_alb ? 1 : 0
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

  # ALB mode
  shared_alb     = var.existing_alb_listener_arn != ""
  standalone_alb = !local.shared_alb

  # ECS cluster mode
  create_cluster = var.existing_ecs_cluster_arn == ""
  cluster_arn    = local.create_cluster ? module.ecs_cluster[0].arn : var.existing_ecs_cluster_arn

  # Smart defaults based on environment
  desired_count_effective           = var.desired_count != null ? var.desired_count : (local.is_prod ? 2 : 1)
  autoscaling_min_effective         = var.autoscaling_min_capacity != null ? var.autoscaling_min_capacity : local.desired_count_effective
  autoscaling_max_effective         = var.autoscaling_max_capacity != null ? var.autoscaling_max_capacity : (local.is_prod ? 10 : 4)
  redis_node_type_effective         = var.redis_node_type != null ? var.redis_node_type : "cache.t4g.micro"
  alb_deletion_protection_effective = var.alb_deletion_protection != null ? var.alb_deletion_protection : local.is_prod
  log_retention_effective           = var.log_retention_days != null ? var.log_retention_days : (local.is_prod ? 30 : 7)
  task_log_retention_effective      = var.task_log_retention_days != null ? var.task_log_retention_days : (local.is_prod ? 365 : 7)
  log_level_effective               = var.log_level != null ? var.log_level : (local.is_prod ? "warn" : "info")
  enable_monitoring_effective       = var.enable_monitoring != null ? var.enable_monitoring : local.is_prod

  # Container image: use provided or fallback to ECR
  manage_ecr      = var.container_image == ""
  container_image = local.manage_ecr ? "${aws_ecrpublic_repository.this[0].repository_uri}:${var.container_image_tag}" : var.container_image

  # ALB ingress CIDRs (standalone mode only)
  cf_ipv4_cidrs = try(data.cloudflare_ip_ranges.this[0].ipv4_cidrs, [])
  alb_ipv4_cidrs = length(var.alb_allowed_ipv4_cidrs) > 0 ? var.alb_allowed_ipv4_cidrs : (
    var.enable_cloudflare ? local.cf_ipv4_cidrs : ["0.0.0.0/0"]
  )
  all_alb_ipv4_cidrs = concat(local.alb_ipv4_cidrs, var.additional_alb_ingress_cidrs)

  # ALB security group ID (standalone creates its own, shared uses existing)
  alb_security_group_id = local.standalone_alb ? module.alb[0].security_group_id : var.existing_alb_security_group_id

  # Target group ARN (standalone from module, shared from resource)
  target_group_arn = local.standalone_alb ? module.alb[0].target_groups["x402"].arn : aws_lb_target_group.shared[0].arn

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

check "vpc_cidr_input" {
  assert {
    condition     = var.vpc_cidr != ""
    error_message = "vpc_cidr is required for Redis and ALB security group rules."
  }
}

check "shared_alb_security_group" {
  assert {
    condition     = !local.shared_alb || var.existing_alb_security_group_id != ""
    error_message = "existing_alb_security_group_id is required when existing_alb_listener_arn is set."
  }
}

check "standalone_alb_dns" {
  assert {
    condition     = local.shared_alb || var.domain_name != ""
    error_message = "domain_name is required when creating a standalone ALB."
  }
}

check "standalone_alb_route53" {
  assert {
    condition     = local.shared_alb || var.route53_zone_id != ""
    error_message = "route53_zone_id is required when creating a standalone ALB."
  }
}

# ---------------------------------------------------------------------------
# SSM Parameters for secrets
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "api_key" {
  name      = "${local.ssm_prefix}/api-key"
  type      = "SecureString"
  value     = var.relayer_api_key
  overwrite = true
  tags      = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "keystore_json" {
  name      = "${local.ssm_prefix}/keystore-json"
  type      = "SecureString"
  value     = var.keystore_json
  overwrite = true
  tags      = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "keystore_passphrase" {
  name      = "${local.ssm_prefix}/keystore-passphrase"
  type      = "SecureString"
  value     = var.keystore_passphrase
  overwrite = true
  tags      = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "storage_encryption_key" {
  count     = var.storage_encryption_key != "" ? 1 : 0
  name      = "${local.ssm_prefix}/storage-encryption-key"
  type      = "SecureString"
  value     = var.storage_encryption_key
  overwrite = true
  tags      = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# ---------------------------------------------------------------------------
# ACM Certificate (created when standalone ALB and no certificate provided)
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "this" {
  count             = local.standalone_alb && var.acm_certificate_arn == "" ? 1 : 0
  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = local.standalone_alb && var.acm_certificate_arn == "" ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  provider = aws.dns
  zone_id  = var.route53_zone_id
  name     = each.value.name
  type     = each.value.type
  ttl      = 60
  records  = [each.value.record]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count                   = local.standalone_alb && var.acm_certificate_arn == "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.acm_validation : record.fqdn]
}

locals {
  certificate_arn = local.standalone_alb ? (
    var.acm_certificate_arn != "" ? var.acm_certificate_arn : aws_acm_certificate.this[0].arn
  ) : ""
}

# ---------------------------------------------------------------------------
# ECS Cluster (optional — created when existing_ecs_cluster_arn is empty)
# ---------------------------------------------------------------------------
module "ecs_cluster" {
  source  = "terraform-aws-modules/ecs/aws//modules/cluster"
  version = "v5.12.0"

  count = local.create_cluster ? 1 : 0

  cluster_name = "${local.app_name}-cluster"
  cluster_settings = [
    {
      name  = "containerInsights"
      value = "enhanced"
    }
  ]
  cluster_configuration = {
    execute_command_configuration = {
      logging = "OVERRIDE"
      log_configuration = {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.cluster[0].name
      }
    }
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Application Load Balancer (standalone mode)
# ---------------------------------------------------------------------------
module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "~> 9.0"

  count = local.standalone_alb ? 1 : 0

  name               = "${local.app_name}-alb"
  load_balancer_type = "application"
  vpc_id             = var.vpc_id
  subnets            = var.public_subnet_ids

  enable_deletion_protection = local.alb_deletion_protection_effective

  access_logs = var.alb_access_logs_bucket != "" ? {
    enabled = true
    bucket  = var.alb_access_logs_bucket
    prefix  = var.alb_access_logs_prefix
  } : { enabled = false }

  security_group_ingress_rules = merge(
    {
      for index, cidr in local.all_alb_ipv4_cidrs :
      "all_https_${index}" => {
        from_port   = 443
        to_port     = 443
        ip_protocol = "tcp"
        cidr_ipv4   = cidr
      }
    },
  )

  security_group_egress_rules = {
    all = {
      ip_protocol = "-1"
      cidr_ipv4   = var.vpc_cidr
    }
  }

  listeners = {
    https = {
      port            = 443
      protocol        = "HTTPS"
      ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-2021-06"
      certificate_arn = local.certificate_arn

      forward = {
        target_group_key = "x402"
      }
    }

    http = {
      port     = 80
      protocol = "HTTP"
      redirect = {
        host        = "#{host}"
        path        = "/#{path}"
        port        = "443"
        protocol    = "HTTPS"
        query       = "#{query}"
        status_code = "HTTP_301"
      }
    }
  }

  target_groups = {
    x402 = {
      protocol                          = "HTTP"
      port                              = local.container_port
      target_type                       = "ip"
      deregistration_delay              = 5
      load_balancing_cross_zone_enabled = true

      health_check = {
        enabled             = true
        healthy_threshold   = 5
        interval            = 60
        matcher             = "401"
        path                = var.health_check_path
        port                = "traffic-port"
        protocol            = "HTTP"
        timeout             = 30
        unhealthy_threshold = 5
      }

      protocol_version  = "HTTP1"
      create_attachment = false
    }
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Shared ALB resources (target group + listener rule)
# ---------------------------------------------------------------------------
resource "aws_lb_target_group" "shared" {
  count = local.shared_alb ? 1 : 0

  name                              = "${local.app_name}-tg"
  port                              = local.container_port
  protocol                          = "HTTP"
  vpc_id                            = var.vpc_id
  target_type                       = "ip"
  deregistration_delay              = 5
  load_balancing_cross_zone_enabled = true

  health_check {
    enabled             = true
    healthy_threshold   = 5
    interval            = 60
    matcher             = "401"
    path                = var.health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 30
    unhealthy_threshold = 5
  }

  tags = local.tags
}

resource "aws_lb_listener_rule" "shared" {
  count = local.shared_alb ? 1 : 0

  listener_arn = var.existing_alb_listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.shared[0].arn
  }

  condition {
    path_pattern {
      values = var.listener_rule_path_patterns
    }
  }

  tags = local.tags
}
