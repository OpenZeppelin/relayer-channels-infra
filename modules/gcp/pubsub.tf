# ---------------------------------------------------------------------------
# Pub/Sub Queue Backend Infrastructure
#
# Creates 8 topics with pull subscriptions for the relayer service.
# Only created when queue_backend = "pubsub".
#
# Topics (with corresponding pull subscriptions):
# 1. transaction-request        - Initial transaction requests
# 2. transaction-submission     - Transaction submission to blockchain
# 3. status-check               - Transaction status polling
# 4. status-check-evm           - EVM transaction status polling
# 5. status-check-stellar       - Stellar transaction status polling
# 6. notification               - Notification delivery
# 7. token-swap-request         - Scheduled token swap processing
# 8. relayer-health-check       - Relayer recovery checks with backoff
# ---------------------------------------------------------------------------

locals {
  queue_configs = {
    transaction-request    = { message_retention = "345600s" }
    transaction-submission = { message_retention = "345600s" }
    status-check           = { message_retention = "345600s" }
    status-check-evm       = { message_retention = "345600s" }
    status-check-stellar   = { message_retention = "345600s" }
    notification           = { message_retention = "345600s" }
    token-swap-request     = { message_retention = "345600s" }
    relayer-health-check   = { message_retention = "345600s" }
  }

  # Only create Pub/Sub resources when the backend is pubsub
  pubsub_queue_configs = var.queue_backend == "pubsub" ? local.queue_configs : {}

  # The app appends its own dash: topic = "{prefix}-{queue-name}", sub = "{prefix}-{queue-name}-sub"
  pubsub_prefix = "${local.pubsub_topic_prefix}-"
}

# ---------------------------------------------------------------------------
# Topics
# ---------------------------------------------------------------------------
resource "google_pubsub_topic" "main" {
  for_each = local.pubsub_queue_configs

  project = var.project_id
  name    = "${local.pubsub_prefix}${each.key}"

  message_retention_duration = each.value.message_retention

  labels = merge(local.labels, {
    type       = "main-topic"
    queue-type = each.key
  })

  depends_on = [google_project_service.apis["pubsub.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Subscriptions
#
# The app extends ack deadlines to 600s per message before processing.
# The subscription ack_deadline is a default that the app overrides per-pull
# ---------------------------------------------------------------------------
resource "google_pubsub_subscription" "main" {
  for_each = local.pubsub_queue_configs

  project = var.project_id
  name    = "${local.pubsub_prefix}${each.key}-sub"
  topic   = google_pubsub_topic.main[each.key].id

  ack_deadline_seconds       = 60
  message_retention_duration = each.value.message_retention
  retain_acked_messages      = false

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  labels = merge(local.labels, {
    type       = "main-subscription"
    queue-type = each.key
  })
}

# ---------------------------------------------------------------------------
# IAM: Allow Cloud Run service account to publish and subscribe
# ---------------------------------------------------------------------------
resource "google_pubsub_topic_iam_member" "cloud_run_publisher" {
  for_each = local.pubsub_queue_configs

  project = var.project_id
  topic   = google_pubsub_topic.main[each.key].name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_pubsub_subscription_iam_member" "cloud_run_subscriber" {
  for_each = local.pubsub_queue_configs

  project      = var.project_id
  subscription = google_pubsub_subscription.main[each.key].name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.cloud_run.email}"
}
