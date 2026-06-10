# Relayer Channels — GCP Terraform Module

Deploy the OpenZeppelin Relayer Channels service on Google Cloud Platform using Cloud Run, Memorystore Redis, Pub/Sub, and Cloud KMS.

## Architecture

```
                                    Internet
                                       |
                              +--------+--------+
                              |                 |
                         (optional)        (direct)
                              |                 |
                     +--------v--------+        |
                     | Cloudflare CDN  |        |
                     | - Workers (/gen)|        |
                     | - KV (API keys) |        |
                     | - Rate limiting |        |
                     +--------+--------+        |
                              |                 |
                     HTTPS (proxied)            |
                              |                 |
                     +--------v-----------------v--------+
                     |    External HTTPS Load Balancer    |
                     |    - Google-managed SSL cert       |
                     |    - Global static IP              |
                     |    - HTTP -> HTTPS redirect        |
                     +--------+--------------------------+
                              |
                     Serverless NEG
                              |
                     +--------v--------+
                     |    Cloud Run    |
                     |    (Relayer)    |
                     |    - Port 8080  |
                     |    - Autoscale  |
                     +--+----+----+---+
                        |    |    |
           +------------+    |    +-------------+
           |                 |                  |
  +--------v--------+ +-----v------+ +---------v---------+
  | Memorystore     | | Cloud KMS  | | Pub/Sub           |
  | Redis           | | (Signing)  | | (Queue Backend)   |
  | - Storage       | | - ED25519  | | - 8 topics        |
  | - Deferred jobs | | - Keyring  | | - 8 subscriptions |
  +--------+--------+ +------------+ +-------------------+
           |
  Private Service Access
  (VPC Peering)
           |
  +--------v--------+
  | VPC Network     |
  | - VPC Connector |
  +--+-----------+--+
     |           |
+----v----+ +----v-----------+
| Secret  | | Cloud          |
| Manager | | Functions      |
| (4 secrets) | (optional   |
+---------+ | balance check) |
            +----------------+
```

### Component Overview

| Component | GCP Service | Purpose |
|-----------|------------|---------|
| **Compute** | Cloud Run v2 | Runs the relayer container with autoscaling |
| **Load Balancer** | External HTTPS LB + Serverless NEG | TLS termination, global static IP, HTTP-to-HTTPS redirect |
| **Data Store** | Memorystore for Redis | Transaction storage, deferred job scheduling |
| **Message Queue** | Pub/Sub (optional) | Distributed job processing with 8 topic/subscription pairs |
| **Signing** | Cloud KMS | ED25519 asymmetric signing for Stellar transactions |
| **Secrets** | Secret Manager | Stores API keys, admin secrets, encryption keys |
| **DNS** | Cloud DNS or Cloudflare | Domain name resolution |
| **CDN/Gateway** | Cloudflare Workers (optional) | API key generation (`/gen`), rate limiting, KV-based auth |
| **Networking** | VPC + VPC Connector | Private connectivity between Cloud Run and Memorystore |
| **Monitoring** | Cloud Functions (optional) | Periodic balance checks |

### How Components Interconnect

1. **Traffic flow**: Internet -> (Cloudflare CDN) -> HTTPS Load Balancer -> Serverless NEG -> Cloud Run
2. **Cloud Run -> Redis**: Via VPC Connector through Private Service Access (VPC peering)
3. **Cloud Run -> Pub/Sub**: Via Application Default Credentials (ADC), uses the Cloud Run service account
4. **Cloud Run -> Cloud KMS**: Via the signer API — credentials are passed when creating a signer via the `/api/v1/signers` endpoint
5. **Cloud Run -> Secret Manager**: Secrets injected as plain environment variables (Secret Manager stores them for out-of-band management)
6. **Cloudflare Worker -> Cloud Run**: Worker proxies requests through the load balancer, injecting the static API key

## Prerequisites

- **Terraform** >= 1.5.0
- **GCP Project** with billing enabled
- **Service Account** with the following roles:
  - `roles/editor` — general resource creation
  - `roles/resourcemanager.projectIamAdmin` — grant IAM roles to service accounts
  - `roles/compute.networkAdmin` — VPC peering for Private Service Access
  - `roles/cloudkms.admin` — create KMS keyrings and keys
  - `roles/pubsub.admin` — create topics/subscriptions and set IAM policies
  - `roles/secretmanager.admin` — create secrets and set IAM policies
  - `roles/run.admin` — manage Cloud Run services
- **Container image** accessible from GCP (Artifact Registry, GCR, or remote repo proxying ECR Public)
- **Cloudflare account** (optional, only if `enable_cloudflare = true`)

## Quick Start

### 1. Set up authentication

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/path/to/service-account-key.json"
```

### 2. Create the Terraform configuration

Create a new directory for your deployment and add these files:

```hcl
# versions.tf
terraform {
  required_version = ">= 1.5.0"

  # Configure your own backend:
  # backend "gcs" {
  #   bucket = "my-terraform-state"
  #   prefix = "relayer-channels/terraform.tfstate"
  # }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0, < 7.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}
```

```hcl
# main.tf
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}

module "relayer_channels" {
  source = "git::https://github.com/OpenZeppelin/relayer-channels-infra.git//modules/gcp?ref=main"

  # Required
  project_id      = var.project_id
  region          = var.region
  environment     = var.environment
  network         = var.network
  subnetwork      = var.subnetwork
  domain_name     = var.domain_name
  container_image = var.container_image

  # Secrets
  relayer_api_key        = var.relayer_api_key
  channels_admin_secret  = var.channels_admin_secret
  storage_encryption_key = var.storage_encryption_key

  # Queue backend
  queue_backend = "pubsub"

  # Optional: Cloudflare
  # enable_cloudflare      = true
  # cloudflare_zone_id     = "your-zone-id"
  # cloudflare_account_id  = "your-account-id"
  # relayer_static_api_key = var.relayer_static_api_key
  # key_salt               = var.key_salt

  # Optional: Labels
  # labels = { team = "infra", project = "relayer" }
}
```

```hcl
# variables.tf
variable "project_id"             { type = string }
variable "region"                 { type = string }
variable "environment"            { type = string }
variable "network"                { type = string }
variable "subnetwork"             { type = string }
variable "domain_name"            { type = string }
variable "container_image"        { type = string }
variable "relayer_api_key"        { type = string; sensitive = true }
variable "channels_admin_secret"  { type = string; sensitive = true }
variable "storage_encryption_key" { type = string; sensitive = true; default = "" }
variable "cloudflare_api_token"   { type = string; sensitive = true; default = "" }
```

```hcl
# outputs.tf
output "load_balancer_ip"       { value = module.relayer_channels.load_balancer_ip }
output "cloud_run_service_uri"  { value = module.relayer_channels.cloud_run_service_uri }
output "domain_name"            { value = module.relayer_channels.domain_name }
output "kms_signing_key_id"     { value = module.relayer_channels.kms_signing_key_id }
```

> **Pinning to a version**: Replace `?ref=main` with a specific tag or commit SHA
> (e.g. `?ref=v1.0.0`) to avoid unexpected changes when the module is updated.
```

### 3. Create terraform.tfvars

```hcl
project_id      = "my-gcp-project"
region          = "us-east1"
environment     = "stg"
network         = "default"
subnetwork      = "default"
domain_name     = "channels.example.com"
container_image = "us-east1-docker.pkg.dev/my-project/repo/relayer:latest"

# Secrets (do NOT commit this file)
relayer_api_key        = "your-api-key"
channels_admin_secret  = "your-admin-secret"
storage_encryption_key = "base64-encoded-32-byte-key"

queue_backend = "pubsub"
```

Generate the storage encryption key:
```bash
openssl rand -base64 32
```

### 4. Deploy

```bash
terraform init
terraform plan
terraform apply
```

### 5. Set up DNS

After apply, get the load balancer IP:
```bash
terraform output load_balancer_ip
```

Create an A record for your domain pointing to this IP. If using Cloudflare, also create a CNAME in Route53 (or your authoritative DNS):
```
channels.example.com -> channels.example.com.cdn.cloudflare.net
```

### 6. Create a signer

Use the provided script to create a GCP Cloud KMS signer:
```bash
ENV=staging API_KEY="your-api-key" \
GCP_SA_KEY_FILE="$HOME/path/to/sa-key.json" \
./scripts/gcp-kms-signer.sh
```

### 7. Create a fund relayer

```bash
ENV=staging API_KEY="your-api-key" \
SIGNER_ID="<signer-id-from-step-6>" \
./scripts/fund-relayer.sh
```

### 8. Verify

```bash
curl https://channels.example.com/api/v1/health
```

## Variables

### Required

| Name | Type | Description |
|------|------|-------------|
| `project_id` | `string` | GCP project ID where resources will be deployed |
| `region` | `string` | GCP region for all resources (e.g. `us-east1`) |
| `environment` | `string` | Deployment environment (e.g. `prod`, `stg`). 1-16 characters. |
| `network` | `string` | VPC network name or self_link for Memorystore and VPC connector |
| `subnetwork` | `string` | Subnet name or self_link for the VPC connector |
| `domain_name` | `string` | Fully qualified domain name for the service (e.g. `channels.example.com`) |
| `container_image` | `string` | Container image URI (e.g. `us-docker.pkg.dev/project/repo/image:tag`) |
| `relayer_api_key` | `string` | Relayer API key (sensitive) |
| `channels_admin_secret` | `string` | Channels plugin admin secret (sensitive) |

### Optional — Core

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `app_name` | `string` | `"relayer-channels"` | Application name prefix for all resources |
| `name_suffix_environment` | `bool` | `true` | Append `-<environment>` to resource names (auto-disabled for prod) |
| `labels` | `map(string)` | `{}` | Labels applied to all resources |

### Optional — Networking

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `connector_machine_type` | `string` | `"e2-micro"` | Machine type for VPC Access connector |
| `connector_min_instances` | `number` | `2` | Minimum connector instances |
| `connector_max_instances` | `number` | `3` | Maximum connector instances |
| `connector_ip_cidr_range` | `string` | `"10.8.0.0/28"` | CIDR range for VPC connector (must be /28, must not overlap existing subnets) |

### Optional — DNS & TLS

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `dns_managed_zone_name` | `string` | `""` | Cloud DNS managed zone name. Leave empty to skip Cloud DNS record creation. |
| `dns_project_id` | `string` | `""` | GCP project ID for Cloud DNS zone (if different from `project_id`) |

### Optional — Container / Cloud Run

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `container_port` | `number` | `8080` | Container port the relayer listens on |
| `cpu` | `string` | `"1"` | Cloud Run CPU allocation (`"1"`, `"2"`, `"4"`) |
| `memory` | `string` | `"2Gi"` | Cloud Run memory allocation (`"2Gi"`, `"4Gi"`) |
| `min_instance_count` | `number` | `null` | Minimum Cloud Run instances. Auto: 2 (prod), 1 (non-prod). |
| `max_instance_count` | `number` | `null` | Maximum Cloud Run instances. Auto: 10 (prod), 4 (non-prod). |
| `cpu_always_allocated` | `bool` | `null` | Whether CPU is always allocated. Auto: true (prod), false (non-prod). |
| `health_check_path` | `string` | `"/api/v1/health"` | HTTP path for startup and liveness probes |
| `container_environment` | `list(object)` | `[]` | Additional env vars (merged with module-managed; user values take precedence) |

### Optional — Relayer Application

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `stellar_network` | `string` | `"testnet"` | Stellar network (`mainnet` or `testnet`) |
| `fund_relayer_id` | `string` | `"channels-fund"` | Fund relayer identifier |
| `allowed_fund_relayer_ids` | `string` | `""` | Comma-separated list of allowed fund relayer IDs |
| `distributed_mode` | `bool` | `true` | Enable distributed mode for cross-instance coordination |
| `queue_backend` | `string` | `"sqs"` | Queue backend: `pubsub` (GCP-native), `redis`, or `sqs` (requires AWS credentials) |
| `sqs_queue_url_prefix` | `string` | `""` | SQS queue URL prefix. Required when `queue_backend = "sqs"`. |
| `log_level` | `string` | `"warn"` | Application log level |

### Optional — Secrets

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `webhook_signing_key` | `string` | `""` | Webhook signing key (sensitive) |
| `storage_encryption_key` | `string` | `""` | Storage encryption key — must be base64-encoded 32 bytes (sensitive) |

### Optional — Redis (Memorystore)

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `redis_tier` | `string` | `null` | `BASIC` or `STANDARD_HA`. Auto: `STANDARD_HA` (prod), `BASIC` (non-prod). |
| `redis_memory_size_gb` | `number` | `null` | Memory in GB. Auto: 5 (prod), 1 (non-prod). |
| `redis_version` | `string` | `"REDIS_7_2"` | Redis version |

### Optional — Pub/Sub

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `pubsub_topic_prefix` | `string` | `""` | Prefix for topic names. Auto: `relayer-{network}-{environment}`. |

When `queue_backend = "pubsub"`, the module creates 8 topics and 8 subscriptions:

| Topic | Subscription | Purpose |
|-------|-------------|---------|
| `{prefix}-transaction-request` | `{prefix}-transaction-request-sub` | Initial transaction requests |
| `{prefix}-transaction-submission` | `{prefix}-transaction-submission-sub` | Blockchain submission |
| `{prefix}-status-check` | `{prefix}-status-check-sub` | Transaction status polling |
| `{prefix}-status-check-evm` | `{prefix}-status-check-evm-sub` | EVM-specific status |
| `{prefix}-status-check-stellar` | `{prefix}-status-check-stellar-sub` | Stellar-specific status |
| `{prefix}-notification` | `{prefix}-notification-sub` | Notification delivery |
| `{prefix}-token-swap-request` | `{prefix}-token-swap-request-sub` | Token swap processing |
| `{prefix}-relayer-health-check` | `{prefix}-relayer-health-check-sub` | Relayer recovery checks |

### Optional — Cloudflare

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `enable_cloudflare` | `bool` | `false` | Enable Cloudflare CDN proxy, Workers gateway, and KV-based API key management |
| `cloudflare_zone_id` | `string` | `""` | Cloudflare zone ID. Required when `enable_cloudflare = true`. |
| `cloudflare_account_id` | `string` | `""` | Cloudflare account ID. Required when `enable_cloudflare = true`. |
| `relayer_static_api_key` | `string` | `""` | Static API key injected by the Worker (sensitive) |
| `key_salt` | `string` | `""` | Salt for hashing user API keys in KV (sensitive) |
| `cf_analytics_api_token` | `string` | `""` | Cloudflare API token with Analytics Read permission (sensitive) |
| `gen_ip_rate_hour` | `number` | `2` | Max `/gen` requests per IP per hour |
| `relay_rpm_per_key` | `number` | `60` | Max relay requests per minute per user key |

### Optional — Cloud Functions

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `enable_balance_check_function` | `bool` | `false` | Deploy a Cloud Function for periodic balance checks |
| `balance_check_schedule` | `string` | `"*/5 * * * *"` | Cron schedule for balance checks |
| `balance_check_extra_urls` | `string` | `""` | Additional `relayerId=balanceUrl` pairs |

### Optional — Observability

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `log_retention_days` | `number` | `null` | Log retention in days. Auto: 30 (prod), 7 (non-prod). |
| `enable_prometheus` | `bool` | `true` | Enable Prometheus metrics collection |

### Optional — Load Balancer

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `lb_deletion_protection` | `bool` | `null` | Enable deletion protection. Auto: true (prod), false (non-prod). |
| `lb_log_sample_rate` | `number` | `0` | Fraction of requests to log (0.0 to 1.0). 0 disables logging. |

## Outputs

| Name | Description |
|------|-------------|
| `cloud_run_service_name` | Cloud Run service name |
| `cloud_run_service_uri` | Cloud Run service URI (internal) |
| `cloud_run_service_account_email` | Cloud Run service account email |
| `load_balancer_ip` | Global static IP address of the HTTPS load balancer |
| `domain_name` | Service domain name |
| `redis_host` | Memorystore Redis host IP |
| `redis_port` | Memorystore Redis port |
| `redis_read_endpoint` | Redis read endpoint (empty for BASIC tier) |
| `pubsub_topics` | Map of queue names to Pub/Sub topic names |
| `pubsub_subscriptions` | Map of queue names to Pub/Sub subscription names |
| `secret_ids` | Map of secret names to Secret Manager secret IDs |
| `kms_key_ring_name` | Cloud KMS key ring name |
| `kms_signing_key_name` | Cloud KMS signing key name |
| `kms_signing_key_id` | Cloud KMS signing key full ID |
| `cloudflare_worker_name` | Cloudflare Worker name (null if disabled) |

## Environment-Based Defaults

The module automatically adjusts resource sizing based on `environment == "prod"`:

| Setting | Production | Non-Production |
|---------|-----------|----------------|
| Min Cloud Run instances | 2 | 1 |
| Max Cloud Run instances | 10 | 4 |
| CPU always allocated | Yes | No |
| Redis tier | STANDARD_HA (failover) | BASIC |
| Redis memory | 5 GB | 1 GB |
| LB deletion protection | Enabled | Disabled |
| Log retention | 30 days | 7 days |

## Queue Backend Options

| Backend | When to Use | Notes |
|---------|------------|-------|
| `pubsub` | **Recommended for GCP.** Native Pub/Sub with 8 topics/subscriptions. | Deferred jobs use Redis sorted sets. Requires app image with Pub/Sub support. |
| `redis` | Single-instance deployments or when Pub/Sub is not available. | Known Lua cjson serialization issue with large i64 values (Stellar sequence numbers). |
| `sqs` | When reusing existing AWS SQS queues from a hybrid deployment. | Requires AWS credentials in `container_environment`. |

## Conditional Resource Creation

| Condition | Resources Created |
|-----------|-------------------|
| `queue_backend == "pubsub"` | 8 Pub/Sub topics + 8 subscriptions + IAM bindings |
| `enable_cloudflare == true` | Cloudflare Worker, KV namespace, DNS record, Workers route |
| `enable_balance_check_function == true` | Cloud Function, Cloud Scheduler job, GCS bucket, service account |
| `webhook_signing_key != ""` | Secret Manager secret for webhook signing key |
| `storage_encryption_key != ""` | Secret Manager secret for storage encryption key |
| `dns_managed_zone_name != ""` | Cloud DNS record (A or CNAME depending on Cloudflare) |
| `lb_log_sample_rate > 0` | Load balancer access logging |

## GCP APIs Enabled

The module automatically enables the following APIs:

- `run.googleapis.com` — Cloud Run
- `secretmanager.googleapis.com` — Secret Manager
- `redis.googleapis.com` — Memorystore
- `pubsub.googleapis.com` — Pub/Sub
- `vpcaccess.googleapis.com` — Serverless VPC Access
- `compute.googleapis.com` — Compute Engine (load balancer, networking)
- `dns.googleapis.com` — Cloud DNS
- `cloudscheduler.googleapis.com` — Cloud Scheduler
- `cloudfunctions.googleapis.com` — Cloud Functions
- `monitoring.googleapis.com` — Cloud Monitoring
- `logging.googleapis.com` — Cloud Logging
- `certificatemanager.googleapis.com` — Certificate Manager
- `servicenetworking.googleapis.com` — Service Networking (Private Service Access)
- `cloudkms.googleapis.com` — Cloud KMS

## IAM Roles Granted

### Cloud Run Service Account (`{app_name}-run`)

| Role | Purpose |
|------|---------|
| `roles/secretmanager.secretAccessor` | Read secrets at startup |
| `roles/monitoring.metricWriter` | Write custom metrics |
| `roles/logging.logWriter` | Write application logs |
| `roles/monitoring.viewer` | Read Pub/Sub backlog depth metrics |
| `roles/cloudkms.signerVerifier` | Sign transactions with KMS key |
| `roles/cloudkms.publicKeyViewer` | Read public key from KMS |
| `roles/pubsub.publisher` | Publish messages to topics (per-topic, when `queue_backend = "pubsub"`) |
| `roles/pubsub.subscriber` | Pull messages from subscriptions (per-subscription, when `queue_backend = "pubsub"`) |

## Known Issues

### Lua cjson i64 Serialization Bug

The relayer app uses a Lua script for atomic Redis `partial_update` operations. Lua's `cjson` library converts all JSON numbers to f64 (doubles), which corrupts large integers like Stellar sequence numbers during the decode/encode roundtrip. This causes `"invalid type: floating point, expected i64"` deserialization errors on subsequent status reads.

**Impact**: Transaction status tracking fails, but actual on-chain transactions succeed.

**Fix**: Requires a code change in `openzeppelin-relayer/src/repositories/transaction/transaction_redis.rs` to perform string-level JSON merging instead of table-level merging in the Lua script.

**Workaround**: None from the infrastructure side. The bug is in the application code.
