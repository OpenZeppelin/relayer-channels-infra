# ---------------------------------------------------------------------------
# ECR Public Repository (optional — created when container_image is empty)
# ---------------------------------------------------------------------------
resource "aws_ecrpublic_repository" "this" {
  count           = local.manage_ecr ? 1 : 0
  repository_name = local.app_name

  tags = local.tags
}

# ---------------------------------------------------------------------------
# CloudWatch Log Groups
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "cluster" {
  name              = "/aws/ecs/${local.app_name}/cluster"
  retention_in_days = local.log_retention_effective
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "task" {
  name              = "/aws/ecs/${local.app_name}/task"
  retention_in_days = local.task_log_retention_effective
  tags              = local.tags
}

# ---------------------------------------------------------------------------
# SSM Parameters for secrets
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "relayer_api_key" {
  name      = "${local.ssm_prefix}/relayer-api-key"
  type      = "SecureString"
  value     = var.relayer_api_key
  overwrite = true
  tags      = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "channels_admin_secret" {
  name      = "${local.ssm_prefix}/channels-admin-secret"
  type      = "SecureString"
  value     = var.channels_admin_secret
  overwrite = true
  tags      = local.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "webhook_signing_key" {
  count     = var.webhook_signing_key != "" ? 1 : 0
  name      = "${local.ssm_prefix}/webhook-signing-key"
  type      = "SecureString"
  value     = var.webhook_signing_key
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
# ACM Certificate (created when acm_certificate_arn is empty)
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "this" {
  count             = var.acm_certificate_arn == "" ? 1 : 0
  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = var.acm_certificate_arn == "" ? {
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
  count                   = var.acm_certificate_arn == "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for record in aws_route53_record.acm_validation : record.fqdn]
}

locals {
  certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : aws_acm_certificate.this[0].arn
}

# ---------------------------------------------------------------------------
# ECS Cluster
# ---------------------------------------------------------------------------
module "ecs_cluster" {
  source  = "terraform-aws-modules/ecs/aws//modules/cluster"
  version = "v5.12.0"

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
        cloud_watch_log_group_name = aws_cloudwatch_log_group.cluster.name
      }
    }
  }

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Application Load Balancer
# ---------------------------------------------------------------------------
module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = "~> 9.0"

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
        target_group_key = "relayer"
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
    relayer = {
      protocol                          = "HTTP"
      port                              = local.container_port
      target_type                       = "ip"
      deregistration_delay              = 5
      load_balancing_cross_zone_enabled = true

      health_check = {
        enabled             = true
        healthy_threshold   = 5
        interval            = 60
        matcher             = "200"
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
# Managed container environment variables (merged with user-provided ones)
# ---------------------------------------------------------------------------
locals {
  managed_environment = [
    { name = "HOST", value = "0.0.0.0" },
    { name = "STELLAR_NETWORK", value = var.stellar_network },
    { name = "FUND_RELAYER_ID", value = var.fund_relayer_id },
    { name = "API_KEY_HEADER", value = "x-consumer-key" },
    { name = "REPOSITORY_STORAGE_TYPE", value = "redis" },
    { name = "RESET_STORAGE_ON_START", value = "false" },
    { name = "METRICS_ENABLED", value = "true" },
    { name = "METRICS_PORT", value = "8081" },
    { name = "LOG_FORMAT", value = "json" },
    { name = "LOG_LEVEL", value = var.log_level },
    { name = "REDIS_URL", value = "redis://${aws_elasticache_replication_group.this.primary_endpoint_address}:6379" },
    { name = "REDIS_READER_URL", value = "redis://${aws_elasticache_replication_group.this.reader_endpoint_address}:6379" },
    { name = "AWS_REGION", value = local.region },
    { name = "AWS_ACCOUNT_ID", value = local.account_id },
    { name = "DISTRIBUTED_MODE", value = tostring(var.distributed_mode) },
    { name = "QUEUE_BACKEND", value = var.distributed_mode ? "sqs" : "memory" },
    { name = "SQS_QUEUE_URL_PREFIX", value = "https://sqs.${local.region}.amazonaws.com/${local.account_id}/${local.sqs_queue_prefix}-" },
  ]

  managed_environment_optional = var.allowed_fund_relayer_ids != "" ? [
    { name = "ALLOWED_FUND_RELAYER_IDS", value = var.allowed_fund_relayer_ids },
  ] : []

  # User-provided values override managed ones
  user_env_keys  = { for e in var.container_environment : e.name => true }
  final_environment = concat(
    [for e in local.managed_environment : e if !lookup(local.user_env_keys, e.name, false)],
    local.managed_environment_optional,
    var.container_environment,
  )

  managed_secrets = compact([
    var.webhook_signing_key != "" ? jsonencode({ name = "WEBHOOK_SIGNING_KEY", valueFrom = aws_ssm_parameter.webhook_signing_key[0].arn }) : "",
    var.storage_encryption_key != "" ? jsonencode({ name = "STORAGE_ENCRYPTION_KEY", valueFrom = aws_ssm_parameter.storage_encryption_key[0].arn }) : "",
    jsonencode({ name = "API_KEY", valueFrom = aws_ssm_parameter.relayer_api_key.arn }),
    jsonencode({ name = "PLUGIN_ADMIN_SECRET", valueFrom = aws_ssm_parameter.channels_admin_secret.arn }),
  ])

  decoded_managed_secrets = [for s in local.managed_secrets : jsondecode(s)]

  user_secret_keys = { for s in var.container_secrets : s.name => true }
  final_secrets = concat(
    [for s in local.decoded_managed_secrets : s if !lookup(local.user_secret_keys, s.name, false)],
    var.container_secrets,
  )
}

# ---------------------------------------------------------------------------
# ECS Service
# ---------------------------------------------------------------------------
module "ecs_service" {
  source  = "terraform-aws-modules/ecs/aws//modules/service"
  version = "v5.12.0"

  name        = "${local.app_name}-service"
  cluster_arn = module.ecs_cluster.arn

  enable_autoscaling       = true
  autoscaling_min_capacity = local.autoscaling_min_effective
  autoscaling_max_capacity = local.autoscaling_max_effective

  cpu           = var.cpu
  memory        = var.memory
  desired_count = local.desired_count_effective

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  launch_type                        = "FARGATE"
  network_mode                       = "awsvpc"
  assign_public_ip                   = true
  skip_destroy                       = true
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"
  enable_execute_command             = true

  runtime_platform = {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  ephemeral_storage = { size_in_gib = var.ephemeral_storage_gib }

  task_exec_iam_statements = [
    {
      effect    = "Allow"
      actions   = ["ecs:ExecuteCommand", "ecs:TagResource"]
      resources = ["*"]
      sid       = "AllowExecuteCommand"
    },
    {
      effect    = "Allow"
      actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:CreateLogGroup"]
      resources = ["arn:aws:logs:${local.region}:*:log-group:/aws/ecs/${local.app_name}/*:*"]
      sid       = "AllowCreateLogGroupAndStreams"
    },
    {
      effect    = "Allow"
      actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
      resources = ["arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.ssm_prefix}/*"]
      sid       = "AllowSSMRead"
    },
  ]

  tasks_iam_role_statements = concat(
    [
      {
        effect    = "Allow"
        actions   = ["cloudwatch:PutMetricData"]
        resources = ["*"]
        sid       = "AllowCloudWatchPutMetrics"
      },
      {
        effect = "Allow"
        actions = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility"
        ]
        resources = ["arn:aws:sqs:${local.region}:${local.account_id}:${local.sqs_queue_prefix}-*"]
        sid       = "AllowSQSQueueAccess"
      },
      {
        effect    = "Allow"
        actions   = ["sqs:ListQueues"]
        resources = ["*"]
        sid       = "AllowListQueues"
      },
      {
        effect = "Allow"
        actions = [
          "ssmmessages:OpenDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:CreateControlChannel"
        ]
        resources = ["*"]
        sid       = "ECSExec"
      },
    ],
    var.enable_prometheus ? [
      {
        effect = "Allow"
        actions = [
          "aps:RemoteWrite",
          "aps:GetSeries",
          "aps:GetLabels",
          "aps:GetMetricMetadata"
        ]
        resources = [aws_prometheus_workspace.this[0].arn]
        sid       = "AllowPrometheusRemoteWrite"
      },
    ] : [],
  )

  container_definitions = merge(
    {
      (local.app_name) = {
        cpu                      = var.enable_cloudwatch_exporter ? var.cpu - 256 : var.cpu
        memory                   = var.enable_cloudwatch_exporter ? var.memory - 512 : var.memory
        name                     = local.app_name
        image                    = local.container_image
        essential                = true
        readonly_root_filesystem = false

        port_mappings = [
          {
            name          = local.app_name
            containerPort = local.container_port
            hostPort      = local.container_port
            protocol      = "tcp"
          },
          {
            name          = "${local.app_name}-metrics"
            containerPort = 8081
            hostPort      = 8081
            protocol      = "tcp"
          },
        ]

        secrets     = local.final_secrets
        environment = local.final_environment

        log_configuration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.task.name
            awslogs-region        = local.region
            awslogs-stream-prefix = local.app_name
          }
        }

        health_check = {
          command      = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.container_port}${var.health_check_path}').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))\""]
          interval     = 30
          timeout      = 10
          retries      = 3
          start_period = 30
        }
      }
    },
    var.enable_cloudwatch_exporter && var.cloudwatch_exporter_image != "" ? {
      cloudwatch-exporter = {
        cpu       = 256
        memory    = 512
        name      = "cloudwatch-exporter"
        image     = var.cloudwatch_exporter_image
        essential = false

        restart_policy = {
          enabled                = true
          ignored_exit_codes     = [0]
          restart_attempt_period = 60
        }

        environment = [
          { name = "RELAYER_HOST", value = "localhost" },
          { name = "RELAYER_PORT", value = "8081" },
          { name = "AWS_REGION", value = local.region },
          { name = "NAMESPACE", value = var.cloudwatch_metrics_namespace },
          { name = "SCRAPE_INTERVAL", value = "60" },
          { name = "LOG_LEVEL", value = var.log_level },
        ]

        depends_on = [
          {
            containerName = local.app_name
            condition     = "START"
          }
        ]

        log_configuration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.task.name
            awslogs-region        = local.region
            awslogs-stream-prefix = "cloudwatch-exporter"
          }
        }

        health_check = {
          command      = ["CMD-SHELL", "python -c \"import os, sys, requests; url='http://127.0.0.1:%s/debug/metrics/scrape' % os.getenv('RELAYER_PORT', '8081'); sys.exit(0 if requests.get(url, timeout=5).status_code == 200 else 1)\""]
          interval     = 60
          timeout      = 10
          retries      = 3
          start_period = 30
        }
      }
    } : {},
  )

  load_balancer = {
    service = {
      target_group_arn = module.alb.target_groups["relayer"].arn
      container_name   = local.app_name
      container_port   = local.container_port
    }
  }

  subnet_ids = var.public_subnet_ids

  security_group_rules = {
    ingress_alb_service = {
      type                     = "ingress"
      from_port                = local.container_port
      to_port                  = local.container_port
      protocol                 = "tcp"
      description              = "Service port"
      source_security_group_id = module.alb.security_group_id
    }
    ingress_metrics_internal = {
      type        = "ingress"
      from_port   = 8081
      to_port     = 8081
      protocol    = "tcp"
      description = "Metrics port (internal only)"
      self        = true
    }
    egress_all = {
      type        = "egress"
      from_port   = 0
      to_port     = 0
      protocol    = "-1"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  tags = local.tags
}
