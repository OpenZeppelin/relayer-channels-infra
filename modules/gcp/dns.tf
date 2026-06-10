# ---------------------------------------------------------------------------
# Cloud DNS
#
# When Cloudflare is enabled: DNS A record is managed by Cloudflare instead.
# When Cloudflare is disabled: Cloud DNS A record → load balancer IP.
# ---------------------------------------------------------------------------

# When Cloudflare is disabled: Cloud DNS A record → LB static IP
resource "google_dns_record_set" "lb_a_record" {
  count = !var.enable_cloudflare && var.dns_managed_zone_name != "" ? 1 : 0

  project      = local.dns_project_id
  managed_zone = var.dns_managed_zone_name
  name         = "${var.domain_name}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.this.address]
}

# When Cloudflare is enabled: Cloud DNS CNAME → Cloudflare CDN
resource "google_dns_record_set" "cloudflare_cname" {
  count = var.enable_cloudflare && var.dns_managed_zone_name != "" ? 1 : 0

  project      = local.dns_project_id
  managed_zone = var.dns_managed_zone_name
  name         = "${var.domain_name}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["${var.domain_name}.cdn.cloudflare.net."]
}

# ---------------------------------------------------------------------------
# Cloudflare DNS (optional)
# ---------------------------------------------------------------------------
resource "cloudflare_dns_record" "this" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id = var.cloudflare_zone_id
  comment = "Relayer Channels LB"
  content = google_compute_global_address.this.address
  name    = var.domain_name
  proxied = true
  ttl     = 1
  type    = "A"
}
