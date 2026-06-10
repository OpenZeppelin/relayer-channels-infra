# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

# Cloud Run
output "cloud_run_service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.this.name
}

output "cloud_run_service_uri" {
  description = "Cloud Run service URI (internal)"
  value       = google_cloud_run_v2_service.this.uri
}

output "cloud_run_service_account_email" {
  description = "Cloud Run service account email"
  value       = google_service_account.cloud_run.email
}

# Load Balancer
output "load_balancer_ip" {
  description = "Global static IP address of the HTTPS load balancer"
  value       = google_compute_global_address.this.address
}

output "domain_name" {
  description = "Service domain name"
  value       = var.domain_name
}

# Redis
output "redis_host" {
  description = "Memorystore Redis host IP"
  value       = google_redis_instance.this.host
}

output "redis_port" {
  description = "Memorystore Redis port"
  value       = google_redis_instance.this.port
}

output "redis_read_endpoint" {
  description = "Memorystore Redis read endpoint (empty for BASIC tier)"
  value       = google_redis_instance.this.read_endpoint
}

# Pub/Sub
output "pubsub_topics" {
  description = "Map of queue names to their Pub/Sub topic names"
  value       = { for key, topic in google_pubsub_topic.main : key => topic.name }
}

output "pubsub_subscriptions" {
  description = "Map of queue names to their Pub/Sub subscription names"
  value       = { for key, sub in google_pubsub_subscription.main : key => sub.name }
}

# Secrets
output "secret_ids" {
  description = "Map of secret names to their Secret Manager secret IDs"
  value = {
    relayer_api_key        = google_secret_manager_secret.relayer_api_key.secret_id
    channels_admin_secret  = google_secret_manager_secret.channels_admin_secret.secret_id
    webhook_signing_key    = var.webhook_signing_key != "" ? google_secret_manager_secret.webhook_signing_key[0].secret_id : null
    storage_encryption_key = var.storage_encryption_key != "" ? google_secret_manager_secret.storage_encryption_key[0].secret_id : null
  }
}

# KMS
output "kms_key_ring_name" {
  description = "Cloud KMS key ring name"
  value       = google_kms_key_ring.this.name
}

output "kms_signing_key_name" {
  description = "Cloud KMS signing key name"
  value       = google_kms_crypto_key.signing.name
}

output "kms_signing_key_id" {
  description = "Cloud KMS signing key full ID"
  value       = google_kms_crypto_key.signing.id
}

# Cloudflare
output "cloudflare_worker_name" {
  description = "Cloudflare Worker name (null if Cloudflare is disabled)"
  value       = var.enable_cloudflare ? cloudflare_worker.gateway[0].name : null
}
