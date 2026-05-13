# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs_cluster.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = module.ecs_cluster.arn
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs_service.name
}

output "ecr_repository_name" {
  description = "ECR public repository name (null if container_image was provided)"
  value       = local.manage_ecr ? aws_ecrpublic_repository.this[0].repository_name : null
}

output "ecr_repository_url" {
  description = "ECR public repository URL (null if container_image was provided)"
  value       = local.manage_ecr ? aws_ecrpublic_repository.this[0].repository_uri : null
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.alb.dns_name
}

output "alb_zone_id" {
  description = "ALB Route53 zone ID"
  value       = module.alb.zone_id
}

output "domain_name" {
  description = "Service domain name"
  value       = var.domain_name
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN"
  value       = local.certificate_arn
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint address"
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "Redis reader endpoint address"
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "sqs_queue_urls" {
  description = "Map of queue names to their URLs"
  value       = { for key, queue in aws_sqs_queue.main : key => queue.url }
}

output "sqs_queue_arns" {
  description = "Map of queue names to their ARNs"
  value       = { for key, queue in aws_sqs_queue.main : key => queue.arn }
}

output "prometheus_workspace_id" {
  description = "Amazon Managed Prometheus workspace ID (null if disabled)"
  value       = var.enable_prometheus ? aws_prometheus_workspace.this[0].id : null
}

output "prometheus_endpoint" {
  description = "Amazon Managed Prometheus remote write endpoint (null if disabled)"
  value       = var.enable_prometheus ? aws_prometheus_workspace.this[0].prometheus_endpoint : null
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for this deployment's secrets"
  value       = local.ssm_prefix
}

output "cloudflare_worker_name" {
  description = "Cloudflare Worker name (null if Cloudflare is disabled)"
  value       = var.enable_cloudflare ? cloudflare_worker.gateway[0].name : null
}
