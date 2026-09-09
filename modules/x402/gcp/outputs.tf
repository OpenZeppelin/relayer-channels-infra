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

# Secrets
output "secret_ids" {
  description = "Map of secret names to their Secret Manager secret IDs"
  sensitive   = true
  value = {
    relayer_api_key        = google_secret_manager_secret.relayer_api_key.secret_id
    keystore_json          = google_secret_manager_secret.keystore_json.secret_id
    keystore_passphrase    = google_secret_manager_secret.keystore_passphrase.secret_id
    storage_encryption_key = var.storage_encryption_key != "" ? google_secret_manager_secret.storage_encryption_key[0].secret_id : null
    channels_api_key       = google_secret_manager_secret.channels_api_key.secret_id
  }
}

# Cloudflare
output "cloudflare_dns_record_id" {
  description = "Cloudflare DNS record ID (null if Cloudflare is disabled)"
  value       = var.enable_cloudflare ? cloudflare_dns_record.this[0].id : null
}
