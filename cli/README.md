# oz-channels

CLI for OpenZeppelin Channels plugin - enables high-throughput Stellar/Soroban transaction submission via channel account pooling with fee sponsorship.

## Table of Contents

- [Installation](#installation)
- [Agent-Friendly Design](#agent-friendly-design)
- [Profiles](#profiles)
- [Commands](#commands)
  - [profile](#profile)
  - [health](#health)
  - [submit](#submit)
  - [bootstrap](#bootstrap)
  - [smoke](#smoke)
  - [channels](#channels)
  - [fee](#fee)
- [Global Options](#global-options)
- [Exit Codes](#exit-codes)

## Installation

```bash
# From the repo root
cd cli
bun install
bun link

# Verify installation
oz-channels --help
```

## Agent-Friendly Design

This CLI is designed to work with AI agents. Run `oz-channels agent-docs` to output documentation that can be provided to LLMs for automated operations.

```bash
oz-channels agent-docs | pbcopy   # Copy to clipboard (macOS)
```

## Profiles

Profiles store connection settings for different environments, making it easy to switch between local development, staging, and production.

### Example Setup

```
local       → http://localhost:8080       (testnet, local dev)
staging     → https://staging.example.com (testnet, staging)
production  → https://relayer.example.com (mainnet, production)
```

### Creating Profiles

```bash
# Interactive setup (recommended for first profile)
oz-channels profile init

# Create named profiles for each environment
oz-channels profile init local
oz-channels profile init staging
oz-channels profile init production
```

Profile init prompts for:
- Channels service URL
- API key
- Plugin ID (optional, for relayer-routed mode)
- Admin secret (optional, for management operations)
- Network (testnet/mainnet)
- Test account name (with option to generate and fund via friendbot)

### Switching Profiles

```bash
# Set default profile
oz-channels profile use production

# Use specific profile for one command
oz-channels health -p staging
```

### Managing Profiles

```bash
oz-channels profile list            # List all profiles
oz-channels profile show [name]     # Show profile details (secrets masked)
oz-channels profile delete <name>   # Delete a profile
oz-channels profile path            # Show config file locations
```

### Config File Locations

| Location | Purpose |
|----------|---------|
| `~/.config/oz-channels/config.yaml` | User config (personal defaults) |
| `.oz-channels/config.yaml` | Project config (shared with team) |

### Config File Format

```yaml
default: production
profiles:
  local:
    url: http://localhost:8080
    api_key: client-key
    plugin_id: channels           # Optional: routes via relayer plugin
    admin_secret: admin-key       # Optional: for management operations
    network: testnet              # testnet, mainnet, or futurenet
    test_account: test-account    # Stellar CLI account name
    smoke_contract: CABC123...    # Deployed smoke contract ID
  production:
    url: https://relayer.example.com
    api_key: prod-key
    plugin_id: channels
    network: mainnet
    protected: true               # Optional: require confirmation for writes
```

### Protected Profiles

Protected profiles require confirmation before write operations (bootstrap, channels set/add/remove). This helps prevent accidental changes to production environments.

**Auto-protection:** Profiles with names containing `prod`, `production`, `main`, `mainnet`, or `live` are automatically protected.

**Explicit protection:** Set `protected: true` or `protected: false` in your profile to override auto-detection.

```bash
# Protected profiles show a warning indicator
oz-channels profile list
# NAME                      URL                           NETWORK
# local                     http://localhost:8080         testnet
# production (protected)    https://relayer.example.com   mainnet
```

### Connection Modes

1. **Via Relayer Plugin** (default): Routes through `/api/v1/plugins/{pluginId}/call`
2. **Direct HTTP**: Connects directly to standalone channels service (omit `plugin_id`)

### Environment Variables

Override config with environment variables:

```bash
OZ_CHANNELS_URL=<url>
OZ_CHANNELS_API_KEY=<key>
OZ_CHANNELS_PLUGIN_ID=<id>
OZ_CHANNELS_ADMIN_SECRET=<secret>
OZ_CHANNELS_PROFILE=<name>
```

### Precedence

CLI flags > Environment variables > Project config > User config

## Commands

### profile

Manage connection profiles. See [Profiles](#profiles) section for detailed usage.

### health

Check service connectivity.

```bash
oz-channels health
```

### submit

Submit transactions to the channels service.

#### submit xdr

Submit a signed XDR transaction:

```bash
oz-channels submit xdr <base64-xdr>           # From argument
oz-channels submit xdr --file tx.xdr          # From file
cat tx.xdr | oz-channels submit xdr -         # From stdin

# Wait for confirmation
oz-channels submit xdr <xdr> --wait --timeout 60
```

#### submit func-auth

Submit a Soroban function call with authorization:

```bash
oz-channels submit func-auth \
  --func <base64-func-xdr> \
  --auth <auth1>,<auth2>
```

### bootstrap

Provision channel accounts at scale with parallel auditing and sequential provisioning.

#### Prerequisites

1. Profile with `admin_secret` configured
2. A funded relayer to use for funding operations (default: `channels-fund`)

#### Basic Usage

```bash
# Create accounts 1-5
oz-channels bootstrap --to 5

# Create accounts 1-100
oz-channels bootstrap --to 100

# Scale up: add accounts 101-200 to existing pool
oz-channels bootstrap --from 101 --to 200

# Custom funding amount
oz-channels bootstrap --to 50 --starting-balance 5
```

#### Three-Phase Workflow

Bootstrap runs in three phases with progress bars:

**Phase 1: Preflight Audit** (parallel)
- Checks signer existence, relayer existence, and on-chain funding
- Runs with configurable concurrency (default: 10)
- Detects gaps in slot sequence

**Phase 2: Provisioning** (sequential)
- Creates signers with random keypairs
- Creates relayers pointing to signers
- Handles 409 Conflict gracefully (already exists)

**Phase 3: Funding** (sequential)
- Fetches competitive fee from Horizon
- Creates accounts on-chain via funding relayer
- Handles `op_already_exists` gracefully

**Final Step:** Merges new accounts into channels plugin config.

#### Gap Detection

Bootstrap detects gaps in the slot sequence to prevent accidental holes:

```bash
# If accounts 1-10 exist, this will error:
oz-channels bootstrap --from 20 --to 25
# Error: Gap detected in slot sequence: 11-19

# Override with --allow-gaps:
oz-channels bootstrap --from 20 --to 25 --allow-gaps
```

#### Dry Run (Preview)

Always preview before large operations:

```bash
oz-channels bootstrap --to 200 --dry-run
# Shows: preflight results, planned changes, no modifications made
```

#### Audit Mode

Report issues without making changes:

```bash
oz-channels bootstrap --to 200 --audit
# Shows: missing signers, missing relayers, unfunded accounts
```

#### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--from <n>` | 1 | Starting slot number (inclusive) |
| `--to <n>` | required | Ending slot number (inclusive) |
| `--funding-relayer <id>` | channels-fund | Relayer for funding |
| `--starting-balance <xlm>` | 2 | XLM per account |
| `--prefix <string>` | channel- | Slot name prefix |
| `--padding <n>` | 4 | Zero-padding (e.g., 0001) |
| `--concurrency <n>` | 10 | Parallel preflight operations |
| `--delay-ms <n>` | 100 | Delay between sequential ops |
| `--audit` | false | Report issues only |
| `--dry-run` | false | Preview without changes |
| `--verbose` | false | Per-account output |
| `--allow-gaps` | false | Allow gaps in sequence |

### smoke

End-to-end testing by submitting real transactions on-chain.

#### Prerequisites

1. Profile with `test_account` configured (Stellar CLI account)
2. Test account must be funded
3. Smoke contract deployed (or run `smoke setup`)

#### Setup (Testnet Only)

Deploy the smoke contract and save to your profile:

```bash
oz-channels smoke setup
```

- **Testnet**: Deploys fresh contract using bundled WASM
- **Mainnet**: Uses pre-deployed bundled contract ID (no setup needed)

#### Running Tests

```bash
# List available tests
oz-channels smoke list

# Run all tests
oz-channels smoke run

# Run specific test
oz-channels smoke run --test-id xdr-payment

# Run with concurrency (stress testing)
oz-channels smoke run --concurrency 5
```

#### Available Tests

| Test ID | Description |
|---------|-------------|
| `xdr-payment` | Signed XDR self-payment |
| `xdr-unsigned-soroban` | Unsigned Soroban XDR with signed auth (smart wallet flow) |
| `func-auth-no-auth` | `no_auth_bump(42)` call |
| `func-auth-address-auth` | `write_with_address_auth(777)` call |

#### Complete Smoke Test Workflow

```bash
# 1. Ensure profile has test account
oz-channels profile show

# 2. Deploy smoke contract (testnet only)
oz-channels smoke setup

# 3. Run all tests
oz-channels smoke run

# 4. Run with debug output if issues
oz-channels smoke run --debug
```

### channels

Manage channel account pool configuration.

**Requires:** `admin_secret` in profile

```bash
oz-channels channels list                    # List configured channel relayer IDs
oz-channels channels set <id1> <id2> ...     # Replace all (with confirmation)
oz-channels channels add <id>                # Add to pool
oz-channels channels remove <id>             # Remove from pool
```

### fee

Manage fee limits for API keys.

**Requires:** `admin_secret` in profile

```bash
oz-channels fee usage <api-key>              # Get fee consumption
oz-channels fee limit <api-key>              # Get fee limit
oz-channels fee set-limit <api-key> <limit>  # Set limit (stroops)
oz-channels fee delete-limit <api-key>       # Remove custom limit
```

### completions

Generate shell completion scripts.

```bash
# Bash (add to ~/.bashrc)
eval "$(oz-channels completions bash)"

# Zsh (add to ~/.zshrc AFTER compinit)
eval "$(oz-channels completions zsh)"

# Fish
oz-channels completions fish > ~/.config/fish/completions/oz-channels.fish
```

## Global Options

Available on all subcommands:

```bash
-p, --profile <name>     # Profile to use
    --url <url>          # Override URL
    --api-key <key>      # Override API key
    --plugin-id <id>     # Override plugin ID
    --admin-secret <key> # Override admin secret
    --json               # JSON output
    --no-input           # Disable prompts
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (API error, network failure) |
| 2 | Invalid usage (bad arguments, missing flags) |
| 3 | Authentication failure |
| 4 | Resource not found |
