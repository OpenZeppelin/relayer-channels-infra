# ---------------------------------------------------------------------------
# Lambda: Balance Check (optional)
#
# Periodically checks relayer balance and publishes CloudWatch metrics.
# ---------------------------------------------------------------------------

data "archive_file" "relayer_balance" {
  count       = var.enable_balance_check_lambda ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/relayer_balance.mjs"
  output_path = "${path.module}/relayer_balance.zip"
}

resource "aws_iam_role" "lambda" {
  count = (var.enable_balance_check_lambda || var.enable_restart_on_alarm_lambda) ? 1 : 0
  name  = "${local.app_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
      }
    ]
  })

  tags = local.tags
}

resource "aws_iam_role_policy" "lambda" {
  count = (var.enable_balance_check_lambda || var.enable_restart_on_alarm_lambda) ? 1 : 0
  name  = "${local.app_name}-lambda-policy"
  role  = aws_iam_role.lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.ssm_prefix}/*"
      },
      {
        Effect = "Allow"
        Action = ["ecs:UpdateService", "ecs:DescribeServices", "ecs:DescribeClusters"]
        Resource = [
          "arn:aws:ecs:${local.region}:${local.account_id}:cluster/${local.app_name}-cluster",
          "arn:aws:ecs:${local.region}:${local.account_id}:service/${local.app_name}-cluster/${local.app_name}-service",
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "relayer_balance" {
  count = var.enable_balance_check_lambda ? 1 : 0

  function_name    = "${local.app_name}-balance-check"
  role             = aws_iam_role.lambda[0].arn
  handler          = "relayer_balance.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.relayer_balance[0].output_path
  source_code_hash = data.archive_file.relayer_balance[0].output_base64sha256
  timeout          = 60
  tags             = local.tags

  environment {
    variables = {
      BALANCE_URL                     = "https://${var.domain_name}/api/v1/relayers/${var.fund_relayer_id}/balance"
      EXTRA_BALANCE_URLS              = var.balance_check_extra_urls
      RELAYERS_URL                    = "https://${var.domain_name}/api/v1/relayers"
      PLUGINS_CALL_URL                = "https://${var.domain_name}/api/v1/plugins/channels/call"
      CHANNELS_API_KEY_PARAMETER      = aws_ssm_parameter.relayer_api_key.name
      CHANNELS_ADMIN_SECRET_PARAMETER = aws_ssm_parameter.channels_admin_secret.name
      ENVIRONMENT                     = var.environment
    }
  }
}

resource "aws_cloudwatch_event_rule" "balance_check" {
  count               = var.enable_balance_check_lambda ? 1 : 0
  name                = "${local.app_name}-balance-check"
  schedule_expression = var.balance_check_schedule
}

resource "aws_cloudwatch_event_target" "balance_check" {
  count     = var.enable_balance_check_lambda ? 1 : 0
  rule      = aws_cloudwatch_event_rule.balance_check[0].name
  target_id = "lambda"
  arn       = aws_lambda_function.relayer_balance[0].arn
}

resource "aws_lambda_permission" "balance_check" {
  count         = var.enable_balance_check_lambda ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.relayer_balance[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.balance_check[0].arn
}

# ---------------------------------------------------------------------------
# Lambda: Restart ECS on Alarm (optional)
#
# Forces an ECS redeployment when triggered by a CloudWatch alarm.
# ---------------------------------------------------------------------------

data "archive_file" "restart_ecs_on_alarm" {
  count       = var.enable_restart_on_alarm_lambda ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/restart_ecs_on_alarm.mjs"
  output_path = "${path.module}/restart_ecs_on_alarm.zip"
}

resource "aws_lambda_function" "restart_ecs_on_alarm" {
  count = var.enable_restart_on_alarm_lambda ? 1 : 0

  function_name    = "${local.app_name}-restart-ecs-on-alarm"
  role             = aws_iam_role.lambda[0].arn
  handler          = "restart_ecs_on_alarm.handler"
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  filename         = data.archive_file.restart_ecs_on_alarm[0].output_path
  source_code_hash = data.archive_file.restart_ecs_on_alarm[0].output_base64sha256
  timeout          = 30
  tags             = local.tags

  environment {
    variables = {
      ECS_CLUSTER_NAME = "${local.app_name}-cluster"
      ECS_SERVICE_NAME = "${local.app_name}-service"
    }
  }
}
