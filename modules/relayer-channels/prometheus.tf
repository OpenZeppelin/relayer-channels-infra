# ---------------------------------------------------------------------------
# Amazon Managed Prometheus (AMP)
# ---------------------------------------------------------------------------
resource "aws_prometheus_workspace" "this" {
  count = var.enable_prometheus ? 1 : 0

  alias = "${local.app_name}-metrics"

  tags = merge(local.tags, {
    Name = "${local.app_name}-prometheus"
  })
}
