output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.relayer_channels.ecs_cluster_name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = module.relayer_channels.ecs_cluster_arn
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.relayer_channels.ecs_service_name
}

output "ecr_repository_name" {
  description = "ECR public repository name (null if container_image was provided)"
  value       = module.relayer_channels.ecr_repository_name
}

output "ecr_repository_url" {
  description = "ECR public repository URL (null if container_image was provided)"
  value       = module.relayer_channels.ecr_repository_url
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.relayer_channels.alb_dns_name
}

output "domain_name" {
  description = "Service domain name"
  value       = module.relayer_channels.domain_name
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN"
  value       = module.relayer_channels.acm_certificate_arn
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint address"
  value       = module.relayer_channels.redis_primary_endpoint
}

output "redis_reader_endpoint" {
  description = "Redis reader endpoint address"
  value       = module.relayer_channels.redis_reader_endpoint
}

output "sqs_queue_urls" {
  description = "Map of queue names to their URLs"
  value       = module.relayer_channels.sqs_queue_urls
}

output "prometheus_workspace_id" {
  description = "Amazon Managed Prometheus workspace ID"
  value       = module.relayer_channels.prometheus_workspace_id
}

output "prometheus_endpoint" {
  description = "Amazon Managed Prometheus remote write endpoint"
  value       = module.relayer_channels.prometheus_endpoint
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for this deployment's secrets"
  value       = module.relayer_channels.ssm_parameter_prefix
}

output "cloudflare_worker_name" {
  description = "Cloudflare Worker name (null if Cloudflare is disabled)"
  value       = module.relayer_channels.cloudflare_worker_name
}
