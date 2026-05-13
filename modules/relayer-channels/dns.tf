# ---------------------------------------------------------------------------
# Route53 DNS
# ---------------------------------------------------------------------------

# When Cloudflare is enabled: Route53 CNAME → Cloudflare CDN
resource "aws_route53_record" "cloudflare_cname" {
  count    = var.enable_cloudflare ? 1 : 0
  provider = aws.dns

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = 300
  records = ["${var.domain_name}.cdn.cloudflare.net"]
}

# When Cloudflare is disabled: Route53 alias A record → ALB
resource "aws_route53_record" "alb_alias" {
  count    = var.enable_cloudflare ? 0 : 1
  provider = aws.dns

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.alb.dns_name
    zone_id                = module.alb.zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# Cloudflare DNS (optional)
# ---------------------------------------------------------------------------
resource "cloudflare_dns_record" "this" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = var.cloudflare_zone_id
  comment = "Relayer Channels ALB"
  content = module.alb.dns_name
  name    = var.domain_name
  proxied = true
  ttl     = 1
  type    = "CNAME"
}
