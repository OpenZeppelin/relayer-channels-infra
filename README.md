# Relayer Channels Infrastructure

Terraform module for deploying a Stellar Relayer Channels service on AWS. Operators use this to run the full stack in their own AWS account — ECS Fargate for compute, ElastiCache for state, SQS for job processing, and optional Cloudflare Workers for API-key management.

For the GCP deployment guide, see [`modules/gcp/README.md`](modules/gcp/README.md).

## Architecture

```
User Request
  |
  v
Route53 (domain_name)
  |
  v (optional)
Cloudflare CDN + Workers Gateway (API key management, usage tracking)
  |
  v
AWS ALB (TLS termination via ACM, HTTP -> HTTPS redirect)
  |
  v
ECS Fargate Service (autoscaling, health checks)
  |
  +---> ElastiCache Redis (state, caching, with optional failover)
  +---> SQS Queues (8 queues + DLQs for distributed transaction processing)
  +---> CloudWatch Logs & Metrics
  +---> Amazon Managed Prometheus (optional)
  +---> Lambda: Balance Check + ECS Restart (optional)
```

## Prerequisites

- Terraform >= 1.5.0
- AWS provider < 6.0.0
- Cloudflare provider ~> 5.0 (required even if Cloudflare is disabled — Terraform constraint)
- An AWS account with permissions to create ECS, ALB, ElastiCache, SQS, Lambda, IAM, ACM, Route53, CloudWatch resources
- A VPC with at least 2 public subnets spanning different AZs
- A Route53 hosted zone for your domain
- (Optional) A Cloudflare account if you want CDN + Workers gateway

## Deployment

### 1. Get the module

Clone the repo or reference it as an external module:

```bash
git clone git@github.com:OpenZeppelin/relayer-channels-infra.git
cd relayer-channels-infra
```

Or use it as a remote module in your own Terraform:

```hcl
module "relayer_channels" {
  source = "git::https://github.com/OpenZeppelin/relayer-channels-infra.git//modules/relayer-channels?ref=main"

  providers = {
    aws        = aws
    aws.dns    = aws.dns
    cloudflare = cloudflare
  }

  environment       = "prod"
  vpc_id            = "vpc-abc123"
  vpc_cidr          = "172.31.0.0/16"
  public_subnet_ids = ["subnet-aaa", "subnet-bbb"]
  domain_name       = "channels.mycompany.com"
  route53_zone_id   = "Z0123456789ABCDEF"
  container_image   = "public.ecr.aws/w5h5k2p1/openzeppelin-relayer-channels:mainnet-1.3.39"

  relayer_api_key       = var.relayer_api_key
  channels_admin_secret = var.channels_admin_secret
  stellar_network       = "mainnet"
}
```

### 2. Configure

```bash
cp terraform.tfvars.example terraform.tfvars
```

Fill in the required values:

```hcl
aws_region        = "us-east-1"
environment       = "prod"
vpc_id            = "vpc-XXXXXXXXXXXXXXXXX"
vpc_cidr          = "172.31.0.0/16"
public_subnet_ids = ["subnet-XXXXXXXXXXXXXXXXX", "subnet-XXXXXXXXXXXXXXXXX"]
domain_name       = "channels.yourdomain.com"
route53_zone_id   = "Z0123456789ABCDEF"
container_image   = "public.ecr.aws/w5h5k2p1/openzeppelin-relayer-channels:mainnet-1.3.39"
stellar_network   = "mainnet"
```

Pass secrets as environment variables so they never touch disk:

```bash
export TF_VAR_relayer_api_key="$(openssl rand -hex 32)"
export TF_VAR_channels_admin_secret="$(openssl rand -hex 32)"
export TF_VAR_storage_encryption_key="$(openssl rand -base64 32)"
```

For remote state, uncomment the `backend "s3"` block in `versions.tf`:

```hcl
backend "s3" {
  bucket         = "your-terraform-state-bucket"
  key            = "relayer-channels/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "terraform-locks"
  encrypt        = true
}
```

### 3. Deploy

```bash
terraform init
terraform plan
terraform apply
```

Takes roughly 10–15 minutes. ElastiCache creation is the slowest part (~5–8 min), followed by ACM certificate validation (~2–5 min) and ECS stabilization (~2–3 min).

### 4. Verify

```bash
# Health check
curl https://<your-domain>/api/v1/health

# ECS tasks running
aws ecs list-tasks --cluster $(terraform output -raw ecs_cluster_name) \
  --service-name $(terraform output -raw ecs_service_name)
```

### 5. Configure private RPC endpoints

The public container image ships with the default public Soroban RPC endpoint (`https://soroban.stellar.org`). For production, override it with your own private providers to avoid rate-limiting under load. This is a **one-time operation** — the config persists in Redis across restarts.

```bash
curl -s \
  -H "Authorization: Bearer <your-relayer-api-key>" \
  -H "Content-Type: application/json" \
  -X PATCH https://<your-domain>/api/v1/networks/stellar:mainnet \
  -d '{
    "rpc_urls": [
      { "url": "https://your-primary-rpc-provider.com/your-api-key", "weight": 100 },
      { "url": "https://your-secondary-rpc-provider.com/your-api-key", "weight": 100 }
    ]
  }'
```

Verify:

```bash
curl -s \
  -H "Authorization: Bearer <your-relayer-api-key>" \
  "https://<your-domain>/api/v1/networks?per_page=200" \
  | jq '.data[] | select(.id=="stellar:mainnet") | .rpc_urls'
```

We recommend at least two independent providers for mainnet. The relayer load-balances across the listed URLs by weight and rotates on failure.

> **Note:** Re-run this PATCH only if you perform a `RESET_STORAGE_ON_START=true` restart, which wipes Redis including the network config. Normal restarts and redeployments preserve it.

### 6. Cloudflare (optional)

When `enable_cloudflare = true`, the module provisions a Cloudflare Worker that handles API-key issuance (`/gen` endpoint), per-key rate limiting, and proxies requests to the ALB with static-key injection.

```hcl
enable_cloudflare      = true
cloudflare_zone_id     = "abc123def456"
cloudflare_account_id  = "def456abc123"
relayer_static_api_key = "<same as your relayer_api_key>"
key_salt               = "<openssl rand -base64 32>"
cf_analytics_api_token = "cloudflare-analytics-token"
```

Without Cloudflare, a Route53 alias A record points directly at the ALB. The `/gen` endpoint is not available — there's no self-service API-key generation. Callers authenticate directly with the `relayer_api_key`. If you need per-user keys, rate limiting, or usage tracking without Cloudflare, you'd need your own API gateway or proxy layer.

You should also restrict ALB ingress via `alb_allowed_ipv4_cidrs` or it accepts all traffic.

### Cross-account DNS

If your Route53 zone is in a different AWS account:

```hcl
dns_account_role_arn = "arn:aws:iam::111111111111:role/Terraform"
```

### Bring your own certificate

```hcl
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/abc-123"
```

Leave empty (default) to auto-create via DNS validation.

## Channel Management (oz-channels CLI)

After deploying the infrastructure, use the `oz-channels` CLI (in the `cli/` directory of this repo) to manage channel accounts.

### Install

```bash
cd cli
bun install
bun run build

cd packages/oz-channels && bun link
cd ../oz-relayer && bun link

oz-channels --help
oz-relayer --help
```

Requires [Bun](https://bun.sh) (Node.js 22+ compatible).

### Set up a profile

```bash
oz-channels profile init production
```

You'll be prompted for your service URL, API key, plugin ID (`channels`), admin secret, and network.

Or configure manually in `~/.config/oz-channels/config.yaml`:

```yaml
default: production
profiles:
  production:
    url: https://channels.example.com
    api_key: your-api-key
    plugin_id: channels
    admin_secret: your-admin-secret
    network: mainnet
    protected: true
```

### Bootstrap channel accounts

Preview first:

```bash
oz-channels bootstrap --to 50 --dry-run -p production
```

Then provision:

```bash
# Create accounts 1–50
oz-channels bootstrap --to 50 -p production

# Scale up later
oz-channels bootstrap --from 51 --to 100 -p production
```

Bootstrap runs three phases: preflight audit (parallel), provisioning (sequential), and funding (sequential). It's idempotent — safe to re-run.

#### Bulk funding at scale

When scaling aggressively (e.g. 100 → 1000 channels), `bootstrap` can hit `TRY_AGAIN_LATER` because every `createAccount` serializes on the fund relayer's sequence number. The `scripts/fund-new-channels.ts` script routes the tx source through an existing channel instead, batching up to 100 ops per transaction:

```bash
npx tsx scripts/fund-new-channels.ts \
  --env mainnet \
  --api-key <key> \
  --source-relayer channel-0001 \
  --fund-relayer channels-fund \
  --from 101 --to 1000 \
  --starting-balance 2 \
  --report fund-report.json
```

### Day-to-day operations

```bash
# Check health
oz-channels health -p production

# List channels
oz-channels channels list -p production

# Add/remove channels
oz-channels channels add channel-0050 -p production
oz-channels channels remove channel-0050 -p production

# Inspect transactions
oz-relayer tx show <tx-id> -r channels-fund -p production --json
oz-relayer tx list -r channels-fund --status pending -p production

# Check balance
oz-relayer relayer balance channels-fund -p production
```

## Variables

### Provider Configuration

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `aws_region` | `string` | — | **Yes** | AWS region |
| `cloudflare_api_token` | `string` | `""` | No | Cloudflare API token |
| `aws_assume_role_arn` | `string` | `""` | No | IAM role ARN for resource creation |
| `dns_account_role_arn` | `string` | `""` | No | IAM role ARN for Route53 (cross-account) |

### Core

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `app_name` | `string` | `"relayer-channels"` | No | Resource name prefix |
| `environment` | `string` | — | **Yes** | Deployment environment (`prod`, `stg`, etc.) |
| `name_suffix_environment` | `bool` | `true` | No | Append `-<environment>` to names (auto-disabled for `prod`) |

### Networking

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `vpc_id` | `string` | — | **Yes** | VPC ID |
| `vpc_cidr` | `string` | `""` | **Yes** | VPC CIDR block |
| `public_subnet_ids` | `list(string)` | — | **Yes** | Subnet IDs (at least 2 AZs) |
| `alb_allowed_ipv4_cidrs` | `list(string)` | `[]` | No | IPv4 CIDRs for ALB ingress |
| `alb_allowed_ipv6_cidrs` | `list(string)` | `[]` | No | IPv6 CIDRs for ALB ingress |
| `additional_alb_ingress_cidrs` | `list(string)` | `[]` | No | Extra CIDRs for direct ALB access |

### DNS & TLS

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `domain_name` | `string` | — | **Yes** | FQDN for the service |
| `route53_zone_id` | `string` | `""` | Conditional | Route53 zone ID |
| `route53_zone_name` | `string` | `""` | Conditional | Route53 zone name (alternative to zone ID) |
| `acm_certificate_arn` | `string` | `""` | No | Existing ACM cert ARN (empty = auto-create) |

### Cloudflare (optional)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `enable_cloudflare` | `bool` | `false` | No | Enable Cloudflare Workers gateway |
| `cloudflare_zone_id` | `string` | `""` | Conditional | Zone ID (required when enabled) |
| `cloudflare_account_id` | `string` | `""` | Conditional | Account ID (required when enabled) |
| `relayer_static_api_key` | `string` | `""` | Conditional | Static upstream API key for the Worker |
| `key_salt` | `string` | `""` | Conditional | Salt for hashing user API keys in KV |
| `cf_analytics_api_token` | `string` | `""` | Conditional | Analytics API token |
| `gen_ip_rate_hour` | `number` | `2` | No | Max `/gen` per IP per hour |
| `relay_rpm_per_key` | `number` | `60` | No | Max relay requests per minute per key |

### Container / ECS

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `container_image` | `string` | `""` | No | Image URI (empty = create ECR repo) |
| `container_image_tag` | `string` | `"latest"` | No | Tag (when ECR is created) |
| `container_port` | `number` | `8080` | No | Listen port |
| `cpu` | `number` | `1024` | No | CPU units (1 vCPU = 1024) |
| `memory` | `number` | `2048` | No | Memory in MiB |
| `desired_count` | `number` | `null` | No | Task count (auto: 2 prod, 1 other) |
| `autoscaling_min_capacity` | `number` | `null` | No | Min tasks (auto: `desired_count`) |
| `autoscaling_max_capacity` | `number` | `null` | No | Max tasks (auto: 10 prod, 4 other) |
| `cpu_architecture` | `string` | `"X86_64"` | No | `X86_64` or `ARM64` |
| `ephemeral_storage_gib` | `number` | `50` | No | Ephemeral storage in GiB |
| `health_check_path` | `string` | `"/api/v1/health"` | No | Health check path |
| `container_environment` | `list(object)` | `[]` | No | Extra env vars (merged; user wins) |
| `container_secrets` | `list(object)` | `[]` | No | Extra SSM/Secrets Manager refs |

### Relayer Application

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `stellar_network` | `string` | `"testnet"` | No | `mainnet` or `testnet` |
| `fund_relayer_id` | `string` | `"channels-fund"` | No | Fund relayer ID |
| `allowed_fund_relayer_ids` | `string` | `""` | No | Comma-separated allowed fund relayer IDs |
| `distributed_mode` | `bool` | `true` | No | Enable SQS-backed processing |
| `log_level` | `string` | `"warn"` | No | Log level |

### Secrets

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `relayer_api_key` | `string` | — | **Yes** | Relayer API key (stored in SSM) |
| `channels_admin_secret` | `string` | — | **Yes** | Admin secret (stored in SSM) |
| `webhook_signing_key` | `string` | `""` | No | Webhook signing key (SSM, if set) |
| `storage_encryption_key` | `string` | `""` | No | Encryption key — must be base64-encoded 32 bytes (SSM, if set) |

### Redis (ElastiCache)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `redis_node_type` | `string` | `null` | No | Node type (auto: `cache.r7g.large` prod, `cache.t4g.medium` other) |
| `redis_num_cache_clusters` | `number` | `null` | No | Nodes (auto: 2 prod with failover, 1 other) |
| `redis_engine_version` | `string` | `"7.1"` | No | Engine version |
| `redis_snapshot_retention_days` | `number` | `7` | No | Snapshot retention (0 disables) |

### SQS

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `sqs_queue_prefix` | `string` | `""` | No | Queue name prefix (auto: `relayer-<network>-<environment>`) |

### Lambda (optional)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `enable_balance_check_lambda` | `bool` | `false` | No | Deploy balance check Lambda |
| `balance_check_schedule` | `string` | `"rate(5 minutes)"` | No | Schedule expression |
| `balance_check_extra_urls` | `string` | `""` | No | Extra `relayerId=url` pairs |
| `enable_restart_on_alarm_lambda` | `bool` | `false` | No | Deploy ECS restart Lambda |

### CloudWatch Exporter (optional sidecar)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `enable_cloudwatch_exporter` | `bool` | `false` | No | Enable metrics sidecar |
| `cloudwatch_exporter_image` | `string` | `""` | Conditional | Exporter image (required when enabled) |
| `cloudwatch_metrics_namespace` | `string` | `"RelayerChannelsTransactions"` | No | Metrics namespace |

### Observability

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `log_retention_days` | `number` | `null` | No | Cluster log retention (auto: 30 prod, 7 other) |
| `task_log_retention_days` | `number` | `null` | No | Task log retention (auto: 365 prod, 7 other) |
| `enable_prometheus` | `bool` | `true` | No | Create AMP workspace |

### ALB

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `alb_deletion_protection` | `bool` | `null` | No | Deletion protection (auto: true prod, false other) |
| `alb_access_logs_bucket` | `string` | `""` | No | S3 bucket for access logs (empty = disabled) |
| `alb_access_logs_prefix` | `string` | `"access"` | No | S3 key prefix |

### Tags

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `tags` | `map(string)` | `{}` | No | Tags for all resources |

## Outputs

| Name | Description |
|------|-------------|
| `ecs_cluster_name` | ECS cluster name |
| `ecs_cluster_arn` | ECS cluster ARN |
| `ecs_service_name` | ECS service name |
| `ecr_repository_name` | ECR repo name (null if `container_image` was provided) |
| `ecr_repository_url` | ECR repo URL (null if `container_image` was provided) |
| `alb_dns_name` | ALB DNS name |
| `domain_name` | Service domain name |
| `acm_certificate_arn` | ACM certificate ARN |
| `redis_primary_endpoint` | Redis primary endpoint |
| `redis_reader_endpoint` | Redis reader endpoint |
| `sqs_queue_urls` | Map of queue names → URLs |
| `prometheus_workspace_id` | AMP workspace ID (null if disabled) |
| `prometheus_endpoint` | AMP remote write endpoint (null if disabled) |
| `ssm_parameter_prefix` | SSM prefix for secrets |
| `cloudflare_worker_name` | Worker name (null if disabled) |

## Environment-based defaults

| Setting | `prod` | Other |
|---------|--------|-------|
| `desired_count` | 2 | 1 |
| `autoscaling_max_capacity` | 10 | 4 |
| `redis_node_type` | `cache.r7g.large` | `cache.t4g.medium` |
| `redis_num_cache_clusters` | 2 (with failover) | 1 |
| `alb_deletion_protection` | true | false |
| `log_retention_days` | 30 | 7 |
| `task_log_retention_days` | 365 | 7 |
| Resource name suffix | none | `-<environment>` |

## SQS queues

Eight standard queues handle distributed transaction processing, each backed by a Dead Letter Queue:

| Queue | Visibility Timeout | Max Receives | Purpose |
|-------|-------------------|--------------|---------|
| `transaction-request` | 300s | 6 | Initial transaction requests |
| `transaction-submission` | 120s | 2 | Blockchain submission |
| `status-check` | 300s | 1000 | General status polling |
| `status-check-evm` | 300s | 1000 | EVM status polling |
| `status-check-stellar` | 300s | 1000 | Stellar status polling |
| `notification` | 180s | 6 | Notification delivery |
| `token-swap-request` | 300s | 6 | Token swap processing |
| `relayer-health-check` | 300s | 6 | Health checks with backoff |

## Conditional resource creation

| Condition | Resources Created |
|-----------|-------------------|
| `container_image = ""` | ECR Public repository |
| `acm_certificate_arn = ""` | ACM certificate + Route53 validation |
| `enable_cloudflare = true` | Worker, KV, DNS record, Workers route |
| `enable_cloudflare = false` | Route53 alias A record → ALB |
| `enable_balance_check_lambda = true` | Lambda + EventBridge schedule |
| `enable_restart_on_alarm_lambda = true` | Lambda for ECS restart |
| `enable_cloudwatch_exporter = true` | Sidecar container in ECS task |
| `enable_prometheus = true` | AMP workspace |
| `webhook_signing_key != ""` | SSM parameter |
| `storage_encryption_key != ""` | SSM parameter |
| `alb_access_logs_bucket != ""` | ALB access logging |

## Post-restart checklist

If you ever restart with `RESET_STORAGE_ON_START=true` (which wipes Redis), you need to redo the following:

1. **Re-create the signer** — call the `/api/v1/signers` endpoint with your KMS key config
2. **Re-create the fund relayer** — via the relayer API or your fund-relayer script, using the new signer ID
3. **Re-run the RPC override** — the PATCH to `/api/v1/networks/stellar:mainnet` with your private providers (step 5)
4. **Re-bootstrap channels** — `oz-channels bootstrap --to <N> -p <env>`
5. **Fund the fund relayer** — if the on-chain account was recreated, send XLM to the new address

Normal restarts and redeployments preserve everything in Redis — none of the above is needed.

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|-------------|-----|
| ACM cert stuck in `PENDING_VALIDATION` | DNS record not propagated | Check Route53 for the CNAME validation record; wait a few minutes |
| ECS tasks not starting | Image pull failure or missing secrets | Check `container_image` accessibility; check CloudWatch task logs |
| ALB returning 502/503 | Tasks not healthy yet | Wait 2–3 min; check container logs for startup errors |
| Redis connection refused | Security group issue | Verify ECS tasks and Redis share the same VPC; check SG rules |
| Cloudflare provider error | Provider block required even when disabled | Set `cloudflare_api_token = ""` in tfvars |

View task logs:

```bash
aws logs tail "/aws/ecs/<app_name>/task" --follow
```
