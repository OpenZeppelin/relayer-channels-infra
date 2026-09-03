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
  count             = local.create_cluster ? 1 : 0
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
# Managed container environment variables (merged with user-provided ones)
# ---------------------------------------------------------------------------
locals {
  managed_environment = [
    { name = "HOST", value = "0.0.0.0" },
    { name = "REPOSITORY_STORAGE_TYPE", value = "redis" },
    { name = "RESET_STORAGE_ON_START", value = "false" },
    { name = "CONFIG_FILE_PATH", value = "config/config.json" },
    { name = "METRICS_ENABLED", value = "true" },
    { name = "METRICS_PORT", value = "8081" },
    { name = "LOG_FORMAT", value = "json" },
    { name = "LOG_LEVEL", value = local.log_level_effective },
    { name = "REDIS_URL", value = "redis://${aws_elasticache_replication_group.this.primary_endpoint_address}:6379" },
    { name = "TRANSACTION_EXPIRATION_HOURS", value = "0.1" },
    { name = "REQUEST_TIMEOUT_SECONDS", value = "60" },
    { name = "PLUGIN_POOL_REQUEST_TIMEOUT_SECS", value = "60" },
    { name = "RATE_LIMIT_REQUESTS_PER_SECOND", value = local.is_prod ? "200" : "400" },
    { name = "RATE_LIMIT_BURST", value = local.is_prod ? "200" : "500" },
    { name = "MAX_CONNECTIONS", value = local.is_prod ? "1000" : "4000" },
    { name = "RELAYER_CONCURRENCY_LIMIT", value = local.is_prod ? "400" : "800" },
    { name = "PLUGIN_MAX_CONCURRENCY", value = local.is_prod ? "1000" : "4000" },
    { name = "AWS_REGION", value = local.region },
    { name = "AWS_ACCOUNT_ID", value = local.account_id },
  ]

  # User-provided values override managed ones
  user_env_keys = { for e in var.container_environment : e.name => true }
  final_environment = concat(
    [for e in local.managed_environment : e if !lookup(local.user_env_keys, e.name, false)],
    var.container_environment,
  )

  managed_secrets = compact([
    jsonencode({ name = "API_KEY", valueFrom = aws_ssm_parameter.api_key.arn }),
    jsonencode({ name = "KEYSTORE_JSON", valueFrom = aws_ssm_parameter.keystore_json.arn }),
    jsonencode({ name = "KEYSTORE_PASSPHRASE", valueFrom = aws_ssm_parameter.keystore_passphrase.arn }),
    var.storage_encryption_key != "" ? jsonencode({ name = "STORAGE_ENCRYPTION_KEY", valueFrom = aws_ssm_parameter.storage_encryption_key[0].arn }) : "",
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
  cluster_arn = local.cluster_arn

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

  tasks_iam_role_statements = [
    {
      effect    = "Allow"
      actions   = ["cloudwatch:PutMetricData"]
      resources = ["*"]
      sid       = "AllowCloudWatchPutMetrics"
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
  ]

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
          command      = ["CMD-SHELL", "curl -sf http://127.0.0.1:${local.container_port}${var.health_check_path} || exit 1"]
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
          { name = "LOG_LEVEL", value = local.log_level_effective },
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
      target_group_arn = local.target_group_arn
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
      source_security_group_id = local.alb_security_group_id
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
