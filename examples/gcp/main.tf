provider "google" {
  project = var.project_id
  region  = var.region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

module "relayer_channels" {
  source = "../../modules/gcp"

  # Core
  app_name                = var.app_name
  environment             = var.environment
  name_suffix_environment = var.name_suffix_environment
  project_id              = var.project_id
  region                  = var.region

  # Networking
  network                 = var.network
  subnetwork              = var.subnetwork
  connector_ip_cidr_range = var.connector_ip_cidr_range

  # DNS & TLS
  domain_name           = var.domain_name
  dns_managed_zone_name = var.dns_managed_zone_name
  dns_project_id        = var.dns_project_id

  # Cloudflare (optional)
  enable_cloudflare      = var.enable_cloudflare
  cloudflare_zone_id     = var.cloudflare_zone_id
  cloudflare_account_id  = var.cloudflare_account_id
  relayer_static_api_key = var.relayer_static_api_key
  key_salt               = var.key_salt
  cf_analytics_api_token = var.cf_analytics_api_token
  gen_ip_rate_hour       = var.gen_ip_rate_hour
  relay_rpm_per_key      = var.relay_rpm_per_key

  # Container / Cloud Run
  container_image       = var.container_image
  container_port        = var.container_port
  cpu                   = var.cpu
  memory                = var.memory
  min_instance_count    = var.min_instance_count
  max_instance_count    = var.max_instance_count
  health_check_path     = var.health_check_path
  container_environment = var.container_environment

  # Relayer application
  stellar_network          = var.stellar_network
  fund_relayer_id          = var.fund_relayer_id
  allowed_fund_relayer_ids = var.allowed_fund_relayer_ids
  distributed_mode         = var.distributed_mode
  queue_backend            = var.queue_backend
  sqs_queue_url_prefix     = var.sqs_queue_url_prefix
  log_level                = var.log_level

  # Secrets
  relayer_api_key        = var.relayer_api_key
  channels_admin_secret  = var.channels_admin_secret
  webhook_signing_key    = var.webhook_signing_key
  storage_encryption_key = var.storage_encryption_key

  # Redis (Memorystore)
  redis_tier           = var.redis_tier
  redis_memory_size_gb = var.redis_memory_size_gb
  redis_version        = var.redis_version

  # Pub/Sub
  pubsub_topic_prefix = var.pubsub_topic_prefix

  # Cloud Functions
  enable_balance_check_function = var.enable_balance_check_function
  balance_check_schedule        = var.balance_check_schedule
  balance_check_extra_urls      = var.balance_check_extra_urls

  # Observability
  log_retention_days = var.log_retention_days
  enable_prometheus  = var.enable_prometheus

  # Load Balancer
  lb_deletion_protection = var.lb_deletion_protection

  # Labels
  labels = var.labels
}
