# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "ecs_cluster_name" {
  description = "ECS cluster name (null if using existing cluster)"
  value       = local.create_cluster ? module.ecs_cluster[0].name : null
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN (null if using existing cluster)"
  value       = local.create_cluster ? module.ecs_cluster[0].arn : null
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs_service.name
}

output "ecr_repository_url" {
  description = "ECR public repository URL (null if container_image was provided)"
  value       = local.manage_ecr ? aws_ecrpublic_repository.this[0].repository_uri : null
}

output "alb_dns_name" {
  description = "ALB DNS name (null if using shared ALB)"
  value       = local.standalone_alb ? module.alb[0].dns_name : null
}

output "domain_name" {
  description = "Service domain name"
  value       = var.domain_name
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint address"
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for this deployment's secrets"
  value       = local.ssm_prefix
}

output "target_group_arn" {
  description = "Target group ARN (useful when sharing ALB with other services)"
  value       = local.target_group_arn
}

output "sns_topic_arn" {
  description = "SNS topic ARN for alarm notifications (null if monitoring disabled)"
  value       = local.enable_monitoring_effective ? aws_sns_topic.alarms[0].arn : null
}
