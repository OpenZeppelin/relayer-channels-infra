output "cloud_run_service_name" {
  description = "Cloud Run service name"
  value       = module.relayer_channels.cloud_run_service_name
}

output "cloud_run_service_uri" {
  description = "Cloud Run service URI"
  value       = module.relayer_channels.cloud_run_service_uri
}

output "load_balancer_ip" {
  description = "Load balancer static IP"
  value       = module.relayer_channels.load_balancer_ip
}

output "domain_name" {
  description = "Service domain name"
  value       = module.relayer_channels.domain_name
}

output "redis_host" {
  description = "Memorystore Redis host"
  value       = module.relayer_channels.redis_host
}

output "pubsub_topics" {
  description = "Pub/Sub topic names"
  value       = module.relayer_channels.pubsub_topics
}

output "secret_ids" {
  description = "Secret Manager secret IDs"
  value       = module.relayer_channels.secret_ids
}

output "cloudflare_worker_name" {
  description = "Cloudflare Worker name"
  value       = module.relayer_channels.cloudflare_worker_name
}
