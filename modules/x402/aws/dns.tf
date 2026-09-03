# ---------------------------------------------------------------------------
# Route53 DNS (standalone ALB mode only)
# ---------------------------------------------------------------------------

# When Cloudflare is enabled: Route53 CNAME → Cloudflare CDN
resource "aws_route53_record" "cloudflare_cname" {
  count    = local.standalone_alb && var.enable_cloudflare ? 1 : 0
  provider = aws.dns

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = 300
  records = ["${var.domain_name}.cdn.cloudflare.net"]
}

# When Cloudflare is disabled: Route53 alias A record → ALB
resource "aws_route53_record" "alb_alias" {
  count    = local.standalone_alb && !var.enable_cloudflare ? 1 : 0
  provider = aws.dns

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.alb[0].dns_name
    zone_id                = module.alb[0].zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# Cloudflare DNS (optional, standalone ALB mode only)
# ---------------------------------------------------------------------------
resource "cloudflare_dns_record" "this" {
  count = local.standalone_alb && var.enable_cloudflare ? 1 : 0

  zone_id = var.cloudflare_zone_id
  comment = "x402 Facilitator ALB"
  content = module.alb[0].dns_name
  name    = var.domain_name
  proxied = true
  ttl     = 1
  type    = "CNAME"
}
