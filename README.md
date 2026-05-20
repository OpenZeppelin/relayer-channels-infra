# Relayer Channels Infrastructure

Terraform module for deploying a Stellar Relayer Channels service on AWS. Designed for third-party operators to spin up the full infrastructure in their own AWS account.

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

## Quick Start

1. **Configure backend** — uncomment and edit the `backend "s3"` block in `versions.tf`

2. **Create your tfvars file**:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your values
   ```

3. **Deploy**:
   ```bash
   terraform init
   terraform plan
   terraform apply
   ```

## Usage

### Standalone (using this repo directly)

```hcl
# terraform.tfvars
aws_region        = "us-east-1"
environment       = "prod"
vpc_id            = "vpc-abc123"
vpc_cidr          = "172.31.0.0/16"
public_subnet_ids = ["subnet-aaa", "subnet-bbb"]
domain_name       = "channels.mycompany.com"
route53_zone_name = "mycompany.com"
container_image   = "public.ecr.aws/w5h5k2p1/openzeppelin-relayer-channels:mainnet-1.3.39"

relayer_api_key       = "my-api-key"
channels_admin_secret = "my-admin-secret"
stellar_network       = "mainnet"
```

### As an external module

```hcl
module "relayer_channels" {
  source = "github.com/OpenZeppelin/relayer-channels-infra//modules/relayer-channels?ref=main"

  providers = {
    aws        = aws
    aws.dns    = aws.dns
    cloudflare = cloudflare
  }

  app_name        = "my-relayer"
  environment     = "prod"
  vpc_id          = "vpc-abc123"
  vpc_cidr        = "172.31.0.0/16"
  public_subnet_ids = ["subnet-aaa", "subnet-bbb"]
  domain_name     = "channels.mycompany.com"
  route53_zone_id = "Z0123456789ABCDEF"
  container_image = "public.ecr.aws/w5h5k2p1/openzeppelin-relayer-channels:mainnet-1.3.39"

  relayer_api_key       = var.relayer_api_key
  channels_admin_secret = var.channels_admin_secret
  stellar_network       = "mainnet"
}
```

### With Cloudflare enabled

```hcl
enable_cloudflare      = true
cloudflare_zone_id     = "abc123def456"
cloudflare_account_id  = "def456abc123"
relayer_static_api_key = "static-key-for-upstream"
key_salt               = "random-salt-for-hashing"
cf_analytics_api_token = "cloudflare-analytics-token"
```

### Without Cloudflare (default)

When `enable_cloudflare = false` (the default):
- A Route53 alias `A` record points directly at the ALB
- No Cloudflare Workers, KV, or CDN proxy
- You are responsible for restricting ALB ingress via `alb_allowed_ipv4_cidrs` or the ALB accepts all traffic

### Cross-account DNS

If your Route53 zone is in a different AWS account:

```hcl
dns_account_role_arn = "arn:aws:iam::111111111111:role/Terraform"
```

### Bring your own certificate

```hcl
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/abc-123"
```

When empty (default), the module creates an ACM certificate and validates it via Route53.

## Variables

### Provider Configuration

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `aws_region` | `string` | — | **Yes** | AWS region for all resources |
| `cloudflare_api_token` | `string` | `""` | No | Cloudflare API token (required when `enable_cloudflare = true`) |
| `aws_assume_role_arn` | `string` | `""` | No | IAM role ARN to assume for resource creation |
| `dns_account_role_arn` | `string` | `""` | No | IAM role ARN to assume for Route53 operations (cross-account) |

### Core

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `app_name` | `string` | `"relayer-channels"` | No | Application name prefix for all resources |
| `environment` | `string` | — | **Yes** | Deployment environment (`prod`, `stg`, etc.) |
| `name_suffix_environment` | `bool` | `true` | No | Append `-<environment>` to resource names (disabled when environment is `prod`) |

### Networking

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `vpc_id` | `string` | — | **Yes** | VPC ID |
| `vpc_cidr` | `string` | `""` | **Yes** | VPC CIDR block (used for ALB egress rules) |
| `public_subnet_ids` | `list(string)` | — | **Yes** | Public subnet IDs (at least 2 AZs) |
| `alb_allowed_ipv4_cidrs` | `list(string)` | `[]` | No | IPv4 CIDRs for ALB ingress. Empty = Cloudflare IPs (if enabled) or `0.0.0.0/0` |
| `alb_allowed_ipv6_cidrs` | `list(string)` | `[]` | No | IPv6 CIDRs for ALB ingress |
| `additional_alb_ingress_cidrs` | `list(string)` | `[]` | No | Additional IPv4 CIDRs for direct ALB access (e.g. VPN) |

### DNS & TLS

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `domain_name` | `string` | — | **Yes** | FQDN for the service (e.g. `channels.example.com`) |
| `route53_zone_id` | `string` | `""` | Conditional | Route53 zone ID. Required if `route53_zone_name` is not set. |
| `route53_zone_name` | `string` | `""` | Conditional | Route53 zone name for dynamic lookup. Ignored if `route53_zone_id` is set. |
| `acm_certificate_arn` | `string` | `""` | No | Existing ACM certificate ARN. Empty = auto-create via DNS validation. |

### Cloudflare (optional)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `enable_cloudflare` | `bool` | `false` | No | Enable Cloudflare CDN proxy + Workers gateway |
| `cloudflare_zone_id` | `string` | `""` | Conditional | Cloudflare zone ID (required when `enable_cloudflare = true`) |
| `cloudflare_account_id` | `string` | `""` | Conditional | Cloudflare account ID (required when `enable_cloudflare = true`) |
| `relayer_static_api_key` | `string` | `""` | Conditional | Static upstream API key injected by the Worker (required when `enable_cloudflare = true`) |
| `key_salt` | `string` | `""` | Conditional | Salt for hashing user API keys in KV (required when `enable_cloudflare = true`) |
| `cf_analytics_api_token` | `string` | `""` | Conditional | Cloudflare Analytics API token (required when `enable_cloudflare = true`) |
| `gen_ip_rate_hour` | `number` | `2` | No | Max `/gen` requests per IP per hour |
| `relay_rpm_per_key` | `number` | `60` | No | Max relay requests per minute per user key |

### Container / ECS

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `container_image` | `string` | `""` | No | Container image URI. Empty = create ECR repository. |
| `container_image_tag` | `string` | `"latest"` | No | Image tag (used when ECR is created) |
| `container_port` | `number` | `8080` | No | Container listen port |
| `cpu` | `number` | `1024` | No | ECS task CPU units (1 vCPU = 1024) |
| `memory` | `number` | `2048` | No | ECS task memory in MiB |
| `desired_count` | `number` | `null` | No | Desired task count. Default: `2` (prod), `1` (other) |
| `autoscaling_min_capacity` | `number` | `null` | No | Min tasks for autoscaling. Default: `desired_count` |
| `autoscaling_max_capacity` | `number` | `null` | No | Max tasks for autoscaling. Default: `10` (prod), `4` (other) |
| `cpu_architecture` | `string` | `"X86_64"` | No | CPU architecture (`X86_64` or `ARM64`) |
| `ephemeral_storage_gib` | `number` | `50` | No | Ephemeral storage in GiB |
| `health_check_path` | `string` | `"/api/v1/health"` | No | HTTP health check path |
| `container_environment` | `list(object)` | `[]` | No | Additional env vars (merged with module-managed; user values take precedence) |
| `container_secrets` | `list(object)` | `[]` | No | Additional SSM/Secrets Manager refs (merged with module-managed secrets) |

### Relayer Application

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `stellar_network` | `string` | `"testnet"` | No | Stellar network (`mainnet` or `testnet`) |
| `fund_relayer_id` | `string` | `"channels-fund"` | No | Fund relayer identifier |
| `allowed_fund_relayer_ids` | `string` | `""` | No | Comma-separated list of allowed fund relayer IDs |
| `distributed_mode` | `bool` | `true` | No | Enable SQS-backed distributed processing |
| `log_level` | `string` | `"warn"` | No | Application log level |

### Secrets

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `relayer_api_key` | `string` | — | **Yes** | Relayer API key (stored in SSM) |
| `channels_admin_secret` | `string` | — | **Yes** | Channels plugin admin secret (stored in SSM) |
| `webhook_signing_key` | `string` | `""` | No | Webhook signing key (stored in SSM if provided) |
| `storage_encryption_key` | `string` | `""` | No | Storage encryption key (stored in SSM if provided) |

### Redis (ElastiCache)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `redis_node_type` | `string` | `null` | No | Node type. Default: `cache.r7g.large` (prod), `cache.t4g.medium` (other) |
| `redis_num_cache_clusters` | `number` | `null` | No | Number of nodes. Default: `2` (prod, with failover), `1` (other) |
| `redis_engine_version` | `string` | `"7.1"` | No | Redis engine version |
| `redis_snapshot_retention_days` | `number` | `7` | No | Snapshot retention days (0 disables) |

### SQS

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `sqs_queue_prefix` | `string` | `""` | No | SQS queue name prefix. Default: `relayer-<network>-<environment>` |

### Lambda (optional monitoring)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `enable_balance_check_lambda` | `bool` | `false` | No | Deploy balance check Lambda |
| `balance_check_schedule` | `string` | `"rate(5 minutes)"` | No | EventBridge schedule expression |
| `balance_check_extra_urls` | `string` | `""` | No | Additional `relayerId=url` pairs for balance checks |
| `enable_restart_on_alarm_lambda` | `bool` | `false` | No | Deploy ECS restart Lambda |

### CloudWatch Exporter (optional sidecar)

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `enable_cloudwatch_exporter` | `bool` | `false` | No | Enable metrics exporter sidecar |
| `cloudwatch_exporter_image` | `string` | `""` | Conditional | Exporter container image (required when enabled) |
| `cloudwatch_metrics_namespace` | `string` | `"RelayerChannelsTransactions"` | No | CloudWatch metrics namespace |

### Observability

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `log_retention_days` | `number` | `null` | No | Cluster log retention. Default: `30` (prod), `7` (other) |
| `task_log_retention_days` | `number` | `null` | No | Task log retention. Default: `365` (prod), `7` (other) |
| `enable_prometheus` | `bool` | `true` | No | Create Amazon Managed Prometheus workspace |

### ALB

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `alb_deletion_protection` | `bool` | `null` | No | ALB deletion protection. Default: `true` (prod), `false` (other) |
| `alb_access_logs_bucket` | `string` | `""` | No | S3 bucket for ALB access logs (empty = disabled) |
| `alb_access_logs_prefix` | `string` | `"access"` | No | S3 key prefix for access logs |

### Tags

| Name | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `tags` | `map(string)` | `{}` | No | Tags applied to all resources |

## Outputs

| Name | Description |
|------|-------------|
| `ecs_cluster_name` | ECS cluster name |
| `ecs_cluster_arn` | ECS cluster ARN |
| `ecs_service_name` | ECS service name |
| `ecr_repository_name` | ECR public repository name (null if `container_image` was provided) |
| `ecr_repository_url` | ECR public repository URL (null if `container_image` was provided) |
| `alb_dns_name` | ALB DNS name |
| `domain_name` | Service domain name |
| `acm_certificate_arn` | ACM certificate ARN |
| `redis_primary_endpoint` | Redis primary endpoint address |
| `redis_reader_endpoint` | Redis reader endpoint address |
| `sqs_queue_urls` | Map of queue names to URLs |
| `prometheus_workspace_id` | AMP workspace ID (null if disabled) |
| `prometheus_endpoint` | AMP remote write endpoint (null if disabled) |
| `ssm_parameter_prefix` | SSM Parameter Store prefix for secrets |
| `cloudflare_worker_name` | Cloudflare Worker name (null if disabled) |

## Conditional Resource Creation

| Condition | Resources Created |
|-----------|-------------------|
| `container_image = ""` | ECR Public repository |
| `acm_certificate_arn = ""` | ACM certificate + Route53 DNS validation |
| `enable_cloudflare = true` | Cloudflare Worker, KV namespace, DNS record, Workers route |
| `enable_cloudflare = false` | Route53 alias A record pointing to ALB |
| `enable_balance_check_lambda = true` | Lambda function + EventBridge schedule |
| `enable_restart_on_alarm_lambda = true` | Lambda function for ECS restart |
| `enable_cloudwatch_exporter = true` | Sidecar container in ECS task |
| `enable_prometheus = true` | Amazon Managed Prometheus workspace |
| `webhook_signing_key != ""` | SSM parameter for webhook signing key |
| `storage_encryption_key != ""` | SSM parameter for storage encryption key |
| `alb_access_logs_bucket != ""` | ALB access logging to S3 |

## Environment-Based Defaults

| Variable | `prod` | Other |
|----------|--------|-------|
| `desired_count` | 2 | 1 |
| `autoscaling_max_capacity` | 10 | 4 |
| `redis_node_type` | `cache.r7g.large` | `cache.t4g.medium` |
| `redis_num_cache_clusters` | 2 (with failover) | 1 |
| `alb_deletion_protection` | `true` | `false` |
| `log_retention_days` | 30 | 7 |
| `task_log_retention_days` | 365 | 7 |
| Resource name suffix | none | `-<environment>` |

## SQS Queues

The module creates 8 standard queues for distributed transaction processing, each with a Dead Letter Queue:

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

## Step-by-Step Deployment Guide

This guide walks through deploying the Relayer Channels service from scratch in your own AWS account.

### Step 1: AWS Account Prerequisites

Ensure you have the following in your AWS account before starting:

1. **AWS CLI configured** with credentials that have admin-level access (or at minimum: ECS, EC2, ElastiCache, SQS, Lambda, IAM, ACM, Route53, CloudWatch, SSM permissions):
   ```bash
   aws sts get-caller-identity   # verify your credentials
   ```

2. **A VPC with at least 2 public subnets** in different Availability Zones. If you don't have one, use the AWS default VPC:
   ```bash
   # Find your default VPC
   aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text

   # Find its CIDR
   aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].CidrBlock" --output text

   # List public subnets (pick 2 in different AZs)
   aws ec2 describe-subnets --filters "Name=vpc-id,Values=<your-vpc-id>" \
     --query "Subnets[*].[SubnetId,AvailabilityZone]" --output table
   ```

3. **A Route53 hosted zone** for the domain you want to use (e.g. `channels.blockdaemon.com`):
   ```bash
   aws route53 list-hosted-zones --query "HostedZones[*].[Id,Name]" --output table
   ```
   Note the Zone ID — you'll need it in your configuration.

4. **Terraform >= 1.5.0** installed:
   ```bash
   terraform version
   ```

### Step 2: Set Up the Terraform Project

You can either clone this repo directly or reference it as a remote module.

**Option A: Clone and deploy (recommended for first-time setup)**

```bash
git clone git@github.com:OpenZeppelin/relayer-channels-infra.git
cd relayer-channels-infra
```

**Option B: Reference as a remote module**

Create a new directory for your deployment and add a `main.tf`:

```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "< 6.0.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "dns"
  region = var.aws_region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "aws_region" {
  default = "us-east-1"
}

variable "cloudflare_api_token" {
  default   = ""
  sensitive = true
}

variable "relayer_api_key" {
  sensitive = true
}

variable "channels_admin_secret" {
  sensitive = true
}

module "relayer_channels" {
  source = "github.com/OpenZeppelin/relayer-channels-infra//modules/relayer-channels?ref=main"

  providers = {
    aws        = aws
    aws.dns    = aws.dns
    cloudflare = cloudflare
  }

  aws_region        = var.aws_region
  environment       = "prod"
  vpc_id            = "vpc-XXXXXXXXXXXXXXXXX"       # your VPC ID
  vpc_cidr          = "172.31.0.0/16"                # your VPC CIDR
  public_subnet_ids = ["subnet-XXX", "subnet-YYY"]   # your subnet IDs
  domain_name       = "channels.yourdomain.com"       # your FQDN
  route53_zone_id   = "Z0123456789ABCDEF"             # your Route53 zone ID
  container_image   = "public.ecr.aws/w5h5k2p1/openzeppelin-relayer-channels:mainnet-1.3.39"
  stellar_network   = "mainnet"

  relayer_api_key       = var.relayer_api_key
  channels_admin_secret = var.channels_admin_secret
}
```

### Step 3: Configure Variables

If using Option A (cloned repo):

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and fill in the required values:

```hcl
# Required — replace with your values
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

For secrets, use environment variables instead of writing them to the file:

```bash
export TF_VAR_relayer_api_key="your-api-key"
export TF_VAR_channels_admin_secret="your-admin-secret"
```

### Step 4: Configure Remote State (Recommended)

For production deployments, configure an S3 backend for Terraform state. Uncomment and edit the `backend "s3"` block in `versions.tf`:

```hcl
backend "s3" {
  bucket         = "your-terraform-state-bucket"
  key            = "relayer-channels/terraform.tfstate"
  region         = "us-east-1"
  dynamodb_table = "terraform-locks"   # optional, for state locking
  encrypt        = true
}
```

Create the S3 bucket and (optionally) DynamoDB table beforehand:

```bash
aws s3 mb s3://your-terraform-state-bucket --region us-east-1
aws s3api put-bucket-versioning --bucket your-terraform-state-bucket --versioning-configuration Status=Enabled
```

### Step 5: Deploy

```bash
# Initialize Terraform (downloads providers and modules)
terraform init

# Preview what will be created
terraform plan

# Deploy (type 'yes' when prompted)
terraform apply
```

The initial deployment takes approximately 10-15 minutes. The longest steps are:
- ACM certificate DNS validation (~2-5 min)
- ElastiCache Redis cluster creation (~5-8 min)
- ECS service stabilization (~2-3 min)

### Step 6: Verify the Deployment

Once `terraform apply` completes, verify the service is running:

```bash
# Check the outputs
terraform output

# Test the health endpoint
curl https://<your-domain>/api/v1/health

# Verify ECS tasks are running
aws ecs list-tasks --cluster $(terraform output -raw ecs_cluster_name) \
  --service-name $(terraform output -raw ecs_service_name)
```

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| ACM certificate stuck in `PENDING_VALIDATION` | DNS validation record not propagated | Verify the CNAME record exists in Route53; wait up to 5 min for propagation |
| ECS tasks failing to start | Container image pull errors | Verify `container_image` is accessible; check ECS task logs in CloudWatch |
| ALB returning 502/503 | Tasks not yet healthy | Wait 2-3 min for health checks to pass; check container logs |
| Redis connection refused | Security group misconfiguration | Verify ECS tasks and Redis are in the same VPC; check security group rules |
| `Error: Cloudflare provider configuration` | Cloudflare provider required even when disabled | This is expected — Terraform requires the provider block. Set `cloudflare_api_token = ""` |

To view ECS task logs:

```bash
aws logs tail /ecs/relayer-channels --follow
```

## Post-Deploy Steps

1. **Push your container image** (if using module-created ECR Public):
   ```bash
   aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws
   docker tag my-relayer:latest <ecr_repository_url>:latest
   docker push <ecr_repository_url>:latest
   ```

2. **Verify the service**:
   ```bash
   curl https://channels.example.com/api/v1/health
   ```

3. **Update secrets** — after initial deploy, update SSM parameters directly in the AWS console or CLI. The module uses `ignore_changes` on secret values to prevent Terraform from overwriting manual updates.

## Channel Management (oz-channels CLI)

After deploying the infrastructure, use the `oz-channels` CLI to manage channel accounts, submit transactions, and operate the service. The CLI lives in the [ops-toolkit](https://github.com/OpenZeppelin/ops-toolkit) monorepo.

### Install the CLI

```bash
git clone git@github.com:OpenZeppelin/ops-toolkit.git
cd ops-toolkit
bun install
cd packages/oz-channels
bun link

# Verify
oz-channels --help
```

> Requires [Bun](https://bun.sh) runtime (Node.js 22+ compatible).

### Configure a Profile

Profiles store connection settings per environment. Create one for your deployed service:

```bash
oz-channels profile init production
```

You'll be prompted for:
- **Channels service URL** — your deployed domain (e.g. `https://channels.blockdaemon.com`)
- **API key** — the `relayer_api_key` you set during Terraform deployment
- **Plugin ID** — `channels` (for relayer-routed mode) or leave empty for direct HTTP
- **Admin secret** — the `channels_admin_secret` from Terraform (required for management operations)
- **Network** — `mainnet` or `testnet`

Or configure manually in `~/.config/oz-channels/config.yaml`:

```yaml
default: production
profiles:
  production:
    url: https://channels.blockdaemon.com
    api_key: your-api-key
    plugin_id: channels
    admin_secret: your-admin-secret
    network: mainnet
    protected: true    # requires confirmation for write operations
```

You can also override per-command with environment variables:

```bash
OZ_CHANNELS_URL=https://channels.blockdaemon.com
OZ_CHANNELS_API_KEY=your-api-key
OZ_CHANNELS_ADMIN_SECRET=your-admin-secret
```

### Verify Connectivity

```bash
oz-channels health -p production
```

### Create Channel Accounts (Bootstrap)

The `bootstrap` command provisions channel accounts at scale in three phases:

1. **Preflight Audit** — checks which signers, relayers, and on-chain accounts already exist (parallel)
2. **Provisioning** — creates signers (random keypairs) and relayers (sequential)
3. **Funding** — creates on-chain Stellar accounts via a funding relayer (sequential)

#### Preview first (dry run)

Always preview before creating accounts:

```bash
oz-channels bootstrap --to 50 --dry-run -p production
```

#### Create accounts

```bash
# Create channel accounts 1-50
oz-channels bootstrap --to 50 -p production

# Scale up later: add accounts 51-100
oz-channels bootstrap --from 51 --to 100 -p production

# Custom funding amount (XLM per account)
oz-channels bootstrap --to 50 --starting-balance 5 -p production
```

#### Audit existing accounts

Check the state of existing accounts without making changes:

```bash
oz-channels bootstrap --to 100 --audit -p production
```

#### Bootstrap options

| Option | Default | Description |
|--------|---------|-------------|
| `--from <n>` | 1 | Starting slot number |
| `--to <n>` | *required* | Ending slot number |
| `--funding-relayer <id>` | `channels-fund` | Relayer used for on-chain funding |
| `--starting-balance <xlm>` | 2 | XLM per account |
| `--prefix <string>` | `channel-` | Slot name prefix |
| `--padding <n>` | 4 | Zero-padding width (e.g. `channel-0001`) |
| `--concurrency <n>` | 10 | Parallel preflight operations |
| `--delay-ms <n>` | 100 | Delay between sequential ops |
| `--audit` | false | Report issues only, no changes |
| `--dry-run` | false | Preview planned changes |
| `--verbose` | false | Per-account output |
| `--allow-gaps` | false | Allow gaps in slot sequence |

### Manage Channel Pool

List, add, or remove channel relayer IDs from the active pool:

```bash
# List active channel accounts
oz-channels channels list -p production

# Add a single channel to the pool
oz-channels channels add channel-0051 -p production

# Remove a channel from the pool
oz-channels channels remove channel-0001 -p production

# Replace the entire pool (with confirmation prompt)
oz-channels channels set channel-0001 channel-0002 channel-0003 -p production
```

### Manage Fee Limits

Control per-API-key fee limits (in stroops):

```bash
# Check fee consumption for an API key
oz-channels fee usage <api-key> -p production

# Get current fee limit
oz-channels fee limit <api-key> -p production

# Set a fee limit (in stroops)
oz-channels fee set-limit <api-key> 1000000000 -p production

# Remove a custom fee limit
oz-channels fee delete-limit <api-key> -p production
```

### Submit Transactions

```bash
# Submit a signed XDR transaction
oz-channels submit xdr <base64-xdr> -p production

# Submit from file
oz-channels submit xdr --file tx.xdr -p production

# Submit and wait for confirmation
oz-channels submit xdr <base64-xdr> --wait --timeout 60 -p production

# Submit a Soroban function call with auth
oz-channels submit func-auth --func <base64-func-xdr> --auth <auth-xdr> -p production
```

### Run Smoke Tests

Validate the deployment end-to-end with real on-chain transactions:

```bash
# Deploy smoke contract (testnet only)
oz-channels smoke setup -p staging

# List available tests
oz-channels smoke list

# Run all smoke tests
oz-channels smoke run -p staging

# Run a specific test
oz-channels smoke run --test-id xdr-payment -p staging

# Stress test with concurrency
oz-channels smoke run --concurrency 5 -p staging
```

Available test IDs:

| Test ID | Description |
|---------|-------------|
| `xdr-payment` | Signed XDR self-payment |
| `xdr-unsigned-soroban` | Unsigned Soroban XDR with signed auth (smart wallet flow) |
| `func-auth-no-auth` | `no_auth_bump(42)` call |
| `func-auth-address-auth` | `write_with_address_auth(777)` call |

### Typical Deployment + Management Workflow

```
1. Deploy infrastructure          →  terraform apply
2. Verify service is running      →  oz-channels health -p production
3. Preview channel creation       →  oz-channels bootstrap --to 50 --dry-run -p production
4. Create channel accounts        →  oz-channels bootstrap --to 50 -p production
5. Verify channels are active     →  oz-channels channels list -p production
6. Run smoke tests (testnet)      →  oz-channels smoke run -p staging
7. Submit transactions            →  oz-channels submit xdr <xdr> -p production
8. Scale up when needed           →  oz-channels bootstrap --from 51 --to 100 -p production
9. Monitor fee usage              →  oz-channels fee usage <api-key> -p production
```

### CLI Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (API error, network failure) |
| 2 | Invalid usage (bad arguments, missing flags) |
| 3 | Authentication failure |
| 4 | Resource not found |

## Security Notes

- All secrets are stored in AWS SSM Parameter Store as `SecureString`
- The `terraform.tfvars` file is gitignored — never commit secrets to version control
- Use `TF_VAR_*` environment variables or a secrets manager for CI/CD pipelines
- The ALB only accepts HTTPS (port 443) with TLS 1.3; HTTP is redirected
- When Cloudflare is enabled, ALB ingress is restricted to Cloudflare IP ranges
- ECS task IAM roles follow least-privilege: SSM read, SQS access, CloudWatch metrics, ECS exec
