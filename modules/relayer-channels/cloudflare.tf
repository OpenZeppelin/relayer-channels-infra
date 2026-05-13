# ---------------------------------------------------------------------------
# Cloudflare Workers Gateway (optional)
#
# Provides:
# - API key generation (/gen endpoint)
# - KV-based user authentication
# - Static API key injection for upstream relayer
# - Usage tracking via Analytics Engine
# ---------------------------------------------------------------------------

# KV namespace for API keys
resource "cloudflare_workers_kv_namespace" "api_keys" {
  count = var.enable_cloudflare ? 1 : 0

  title      = "${local.app_name}-api-keys"
  account_id = var.cloudflare_account_id
}

resource "cloudflare_worker" "gateway" {
  count = var.enable_cloudflare ? 1 : 0

  account_id = var.cloudflare_account_id
  name       = "${local.app_name}-gateway"

  observability = {
    enabled = local.is_prod
    logs = {
      enabled = local.is_prod
    }
  }
}

resource "cloudflare_worker_version" "gateway" {
  count = var.enable_cloudflare ? 1 : 0

  account_id         = var.cloudflare_account_id
  worker_id          = cloudflare_worker.gateway[0].id
  compatibility_date = "2025-09-17"
  main_module        = "worker.mjs"

  modules = [
    {
      name         = "worker.mjs"
      content_type = "application/javascript+module"
      content_file = "${path.module}/worker.mjs"
    }
  ]

  bindings = [
    {
      type         = "kv_namespace"
      name         = "API_KEYS"
      namespace_id = cloudflare_workers_kv_namespace.api_keys[0].id
    },
    {
      type = "plain_text"
      name = "RELAYER_BASE_URL"
      text = "https://${var.domain_name}"
    },
    {
      type = "secret_text"
      name = "RELAYER_STATIC_API_KEY"
      text = var.relayer_static_api_key
    },
    {
      type = "secret_text"
      name = "KEY_SALT"
      text = var.key_salt
    },
    {
      type    = "analytics_engine"
      name    = "USAGE"
      dataset = "${local.app_name}-usage"
    },
    {
      type = "plain_text"
      name = "CF_ACCOUNT_ID"
      text = var.cloudflare_account_id
    },
    {
      type = "secret_text"
      name = "CF_API_TOKEN"
      text = var.cf_analytics_api_token
    },
  ]
}

resource "cloudflare_workers_deployment" "gateway" {
  count = var.enable_cloudflare ? 1 : 0

  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.gateway[0].name
  strategy    = "percentage"

  versions = [{
    percentage = 100
    version_id = cloudflare_worker_version.gateway[0].id
  }]
}

resource "cloudflare_workers_route" "api" {
  count = var.enable_cloudflare ? 1 : 0

  zone_id    = var.cloudflare_zone_id
  pattern    = "${var.domain_name}/*"
  script     = cloudflare_worker.gateway[0].name
  depends_on = [cloudflare_workers_deployment.gateway[0]]
}
