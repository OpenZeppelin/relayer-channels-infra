# ---------------------------------------------------------------------------
# External HTTPS Load Balancer with Serverless NEG
#
# Network Endpoint Group (NEG).
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# SSL Certificate (Google-managed)
# ---------------------------------------------------------------------------
resource "google_compute_managed_ssl_certificate" "this" {
  project = var.project_id
  name    = "${local.app_name}-cert"

  managed {
    domains = [var.domain_name]
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Serverless NEG (points to Cloud Run)
# ---------------------------------------------------------------------------
resource "google_compute_region_network_endpoint_group" "cloud_run" {
  project               = var.project_id
  name                  = "${local.app_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.this.name
  }

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}

# ---------------------------------------------------------------------------
# Backend Service
# ---------------------------------------------------------------------------
resource "google_compute_backend_service" "this" {
  project = var.project_id
  name    = "${local.app_name}-backend"

  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30

  backend {
    group = google_compute_region_network_endpoint_group.cloud_run.id
  }

  dynamic "log_config" {
    for_each = var.lb_log_sample_rate > 0 ? [1] : []
    content {
      enable      = true
      sample_rate = var.lb_log_sample_rate
    }
  }

  # Cloud Armor security policy can be attached here if needed
  # security_policy = google_compute_security_policy.this.id
}

# ---------------------------------------------------------------------------
# URL Map
# ---------------------------------------------------------------------------
resource "google_compute_url_map" "this" {
  project         = var.project_id
  name            = "${local.app_name}-url-map"
  default_service = google_compute_backend_service.this.id
}

# HTTPS redirect URL map
resource "google_compute_url_map" "https_redirect" {
  project = var.project_id
  name    = "${local.app_name}-https-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

# ---------------------------------------------------------------------------
# HTTPS Frontend (Target Proxy + Forwarding Rule)
# ---------------------------------------------------------------------------
resource "google_compute_target_https_proxy" "this" {
  project = var.project_id
  name    = "${local.app_name}-https-proxy"
  url_map = google_compute_url_map.this.id

  ssl_certificates = [google_compute_managed_ssl_certificate.this.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "${local.app_name}-https"
  target                = google_compute_target_https_proxy.this.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.this.id
}

# ---------------------------------------------------------------------------
# HTTP Frontend (redirect to HTTPS)
# ---------------------------------------------------------------------------
resource "google_compute_target_http_proxy" "redirect" {
  project = var.project_id
  name    = "${local.app_name}-http-redirect"
  url_map = google_compute_url_map.https_redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  project               = var.project_id
  name                  = "${local.app_name}-http-redirect"
  target                = google_compute_target_http_proxy.redirect.id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.this.id
}

# ---------------------------------------------------------------------------
# Global Static IP
# ---------------------------------------------------------------------------
resource "google_compute_global_address" "this" {
  project = var.project_id
  name    = "${local.app_name}-ip"

  depends_on = [google_project_service.apis["compute.googleapis.com"]]
}
