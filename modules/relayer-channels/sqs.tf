# ---------------------------------------------------------------------------
# SQS Queue Backend Infrastructure
#
# Standard queues for the relayer:
# 1. transaction-request        — Initial transaction requests
# 2. transaction-submission     — Transaction submission to blockchain
# 3. status-check               — Transaction status polling
# 4. status-check-evm           — EVM transaction status polling
# 5. status-check-stellar       — Stellar transaction status polling
# 6. notification               — Notification delivery
# 7. token-swap-request         — Scheduled token swap processing
# 8. relayer-health-check       — Relayer recovery checks with backoff
#
# Each queue has a corresponding Dead Letter Queue (DLQ).
# ---------------------------------------------------------------------------

locals {
  queue_configs = {
    transaction-request = {
      visibility_timeout_seconds = 300
      max_receive_count          = 6
      message_retention_seconds  = 345600 # 4 days
      receive_wait_time_seconds  = 20
    }
    transaction-submission = {
      visibility_timeout_seconds = 120
      max_receive_count          = 2
      message_retention_seconds  = 345600
      receive_wait_time_seconds  = 20
    }
    status-check = {
      visibility_timeout_seconds = 300
      max_receive_count          = 1000
      message_retention_seconds  = 345600
      receive_wait_time_seconds  = 2
    }
    status-check-evm = {
      visibility_timeout_seconds = 300
      max_receive_count          = 1000
      message_retention_seconds  = 345600
      receive_wait_time_seconds  = 2
    }
    status-check-stellar = {
      visibility_timeout_seconds = 300
      max_receive_count          = 1000
      message_retention_seconds  = 345600
      receive_wait_time_seconds  = 2
    }
    notification = {
      visibility_timeout_seconds = 180
      max_receive_count          = 6
      message_retention_seconds  = 345600
      receive_wait_time_seconds  = 20
    }
    token-swap-request = {
      visibility_timeout_seconds = 300
      max_receive_count          = 6
      message_retention_seconds  = 345600
      receive_wait_time_seconds  = 20
    }
    relayer-health-check = {
      visibility_timeout_seconds = 300
      max_receive_count          = 6
      message_retention_seconds  = 345600
      receive_wait_time_seconds  = 20
    }
  }
}

# ---------------------------------------------------------------------------
# Dead Letter Queues
# ---------------------------------------------------------------------------
resource "aws_sqs_queue" "dlq" {
  for_each = local.queue_configs

  name                      = "${local.sqs_queue_prefix}-${each.key}-dlq"
  message_retention_seconds = 604800 # 7 days

  tags = merge(local.tags, {
    Name = "${local.sqs_queue_prefix}-${each.key}-dlq"
    Type = "dead-letter-queue"
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each = local.queue_configs

  queue_url = aws_sqs_queue.dlq[each.key].id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main[each.key].arn]
  })
}

# ---------------------------------------------------------------------------
# Main Queues
# ---------------------------------------------------------------------------
resource "aws_sqs_queue" "main" {
  for_each = local.queue_configs

  name = "${local.sqs_queue_prefix}-${each.key}"

  visibility_timeout_seconds = each.value.visibility_timeout_seconds
  message_retention_seconds  = each.value.message_retention_seconds
  receive_wait_time_seconds  = each.value.receive_wait_time_seconds
  delay_seconds              = 0
  max_message_size           = 262144 # 256 KB

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  })

  tags = merge(local.tags, {
    Name      = "${local.sqs_queue_prefix}-${each.key}"
    Type      = "main-queue"
    QueueType = each.key
  })
}

# ---------------------------------------------------------------------------
# Queue Resource Policies
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "main_queue_policy" {
  for_each = local.queue_configs

  statement {
    sid    = "AllowEcsTaskRoleAccess"
    effect = "Allow"

    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ChangeMessageVisibility",
    ]

    resources = [aws_sqs_queue.main[each.key].arn]

    principals {
      type        = "AWS"
      identifiers = [format("arn:aws:iam::%s:root", local.account_id)]
    }
  }
}

resource "aws_sqs_queue_policy" "main" {
  for_each  = data.aws_iam_policy_document.main_queue_policy
  queue_url = aws_sqs_queue.main[each.key].url
  policy    = each.value.json
}

data "aws_iam_policy_document" "dlq_queue_policy" {
  for_each = local.queue_configs

  statement {
    sid    = "AllowEcsTaskRoleAccess"
    effect = "Allow"

    actions = [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ChangeMessageVisibility",
    ]

    resources = [aws_sqs_queue.dlq[each.key].arn]

    principals {
      type        = "AWS"
      identifiers = [format("arn:aws:iam::%s:root", local.account_id)]
    }
  }
}

resource "aws_sqs_queue_policy" "dlq" {
  for_each  = data.aws_iam_policy_document.dlq_queue_policy
  queue_url = aws_sqs_queue.dlq[each.key].url
  policy    = each.value.json
}

# ---------------------------------------------------------------------------
# CloudWatch Alarms for Queue Monitoring
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "queue_depth" {
  for_each = local.queue_configs

  alarm_name          = "${local.sqs_queue_prefix}-${each.key}-high-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Average"
  threshold           = startswith(each.key, "status-check") ? 10000 : 5000

  alarm_description = "Alert when ${each.key} queue depth exceeds threshold"
  alarm_actions     = []

  dimensions = {
    QueueName = aws_sqs_queue.main[each.key].name
  }

  tags = merge(local.tags, {
    Name      = "${local.sqs_queue_prefix}-${each.key}-high-depth"
    QueueType = each.key
  })
}

resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  for_each = local.queue_configs

  alarm_name          = "${local.sqs_queue_prefix}-${each.key}-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 100

  alarm_description = "Alert when ${each.key} DLQ receives messages (repeated failures)"
  alarm_actions     = []

  dimensions = {
    QueueName = aws_sqs_queue.dlq[each.key].name
  }

  tags = merge(local.tags, {
    Name      = "${local.sqs_queue_prefix}-${each.key}-dlq-alert"
    QueueType = each.key
  })
}

resource "aws_cloudwatch_metric_alarm" "message_age" {
  for_each = local.queue_configs

  alarm_name          = "${local.sqs_queue_prefix}-${each.key}-old-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = each.value.visibility_timeout_seconds * 3

  alarm_description = "Alert when ${each.key} messages are stuck for too long"
  alarm_actions     = []

  dimensions = {
    QueueName = aws_sqs_queue.main[each.key].name
  }

  tags = merge(local.tags, {
    Name      = "${local.sqs_queue_prefix}-${each.key}-old-messages"
    QueueType = each.key
  })
}
