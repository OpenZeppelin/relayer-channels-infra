# ---------------------------------------------------------------------------
# ElastiCache Redis
# ---------------------------------------------------------------------------
resource "aws_security_group" "redis" {
  name        = "${local.app_name}-redis-sg"
  description = "ElastiCache Redis access"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
    description = "Redis from VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "${local.app_name}-redis-sg"
  })
}

resource "aws_elasticache_subnet_group" "this" {
  name        = "${local.app_name}-redis-subnet"
  subnet_ids  = var.public_subnet_ids
  description = "Subnet group for ${local.app_name} Redis"
}

resource "aws_elasticache_parameter_group" "this" {
  name   = "${local.app_name}-redis-params"
  family = "redis7"

  parameter {
    name  = "databases"
    value = 10
  }
}

resource "aws_cloudwatch_log_group" "redis" {
  name              = "/aws/elasticache/${local.app_name}-redis"
  retention_in_days = local.log_retention_effective
  tags              = local.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${local.app_name}-redis"
  description                = "Redis for ${local.app_name}"
  node_type                  = local.redis_node_type_effective
  num_cache_clusters         = local.redis_num_clusters_effective
  automatic_failover_enabled = local.redis_num_clusters_effective > 1
  parameter_group_name       = aws_elasticache_parameter_group.this.name
  port                       = 6379
  security_group_ids         = [aws_security_group.redis.id]
  maintenance_window         = "sat:00:00-sat:01:00"
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  engine_version             = var.redis_engine_version
  apply_immediately          = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "preferred"

  snapshot_window          = var.redis_snapshot_retention_days > 0 ? "22:30-23:30" : null
  snapshot_retention_limit = var.redis_snapshot_retention_days

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis.name
    destination_type = "cloudwatch-logs"
    log_format       = "text"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  depends_on = [aws_elasticache_parameter_group.this]

  tags = merge(local.tags, {
    Name = "${local.app_name}-redis"
  })
}
