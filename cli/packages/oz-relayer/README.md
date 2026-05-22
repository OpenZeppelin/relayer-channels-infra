# oz-relayer

CLI for managing OpenZeppelin Relayer - send transactions, manage relayers, and monitor status.

## Table of Contents

- [Installation](#installation)
- [Agent-Friendly Design](#agent-friendly-design)
- [Profiles](#profiles)
- [Commands](#commands)
  - [profile](#profile)
  - [relayer](#relayer)
  - [tx](#tx)
  - [signer](#signer)
  - [health](#health)
- [Global Options](#global-options)
- [Exit Codes](#exit-codes)

## Installation

```bash
# From the monorepo root
bun install
cd packages/oz-relayer
bun link

# Verify installation
oz-relayer --help
```

## Agent-Friendly Design

This CLI is designed to work with AI agents. Run `oz-relayer agent-docs` to output documentation that can be provided to LLMs for automated operations.

```bash
oz-relayer agent-docs | pbcopy   # Copy to clipboard (macOS)
```

## Profiles

Profiles store connection settings for different environments, making it easy to switch between local development, staging, and production.

### Example Setup

```
local       → http://localhost:8080      (local development)
staging     → https://staging.example.com (staging environment)
production  → https://relayer.example.com (production)
```

### Creating Profiles

```bash
# Interactive setup (recommended for first profile)
oz-relayer profile init

# Create named profiles for each environment
oz-relayer profile init local
oz-relayer profile init staging
oz-relayer profile init production
```

### Switching Profiles

```bash
# Set default profile
oz-relayer profile use production

# Use specific profile for one command
oz-relayer relayer list -p staging
```

### Managing Profiles

```bash
oz-relayer profile list            # List all profiles
oz-relayer profile show [name]     # Show profile details
oz-relayer profile delete <name>   # Delete a profile
oz-relayer profile path            # Show config file locations
```

### Config File Locations

| Location | Purpose |
|----------|---------|
| `~/.config/oz-relayer/config.yaml` | User config (personal defaults) |
| `.oz-relayer/config.yaml` | Project config (shared with team) |

### Config File Format

```yaml
default: production
profiles:
  local:
    url: http://localhost:8080
    api_key: dev-key
    default_relayer: my-relayer    # Optional: skip -r flag
  staging:
    url: https://staging.example.com
    api_key: staging-key
  production:
    url: https://relayer.example.com
    api_key: prod-key
    protected: true                # Optional: require confirmation for writes
```

### Protected Profiles

Protected profiles require confirmation before write operations (pause, resume, send transactions). This helps prevent accidental changes to production environments.

**Auto-protection:** Profiles with names containing `prod`, `production`, `main`, `mainnet`, or `live` are automatically protected.

**Explicit protection:** Set `protected: true` or `protected: false` in your profile to override auto-detection.

```bash
# Protected profiles show a warning indicator
oz-relayer profile list
# NAME                      URL                           DEFAULT RELAYER
# local                     http://localhost:8080         my-relayer
# production (protected)    https://relayer.example.com   -
```

### Environment Variables

Override config with environment variables:

```bash
OZ_RELAYER_URL=http://localhost:8080
OZ_RELAYER_API_KEY=your-api-key
OZ_RELAYER_PROFILE=staging
```

### Precedence

CLI flags > Environment variables > Project config > User config

## Commands

### profile

Manage connection profiles. See [Profiles](#profiles) section for detailed usage.

```bash
oz-relayer profile init [name]     # Create profile interactively
oz-relayer profile list            # List all profiles
oz-relayer profile show [name]     # Show profile details
oz-relayer profile use <name>      # Set default profile
oz-relayer profile delete <name>   # Delete a profile
oz-relayer profile path            # Show config file locations
```

### relayer

Create and manage relayers.

```bash
oz-relayer relayer create <id> [options]  # Create a new relayer
oz-relayer relayer list                   # List all relayers
oz-relayer relayer show <id>              # Show relayer details
oz-relayer relayer status <id>            # Get relayer status
oz-relayer relayer balance <id>           # Get relayer balance
oz-relayer relayer pause <id>             # Pause a relayer
oz-relayer relayer resume <id>            # Resume a relayer
```

**relayer create options:**
- `-t, --network-type <type>` - Network type: evm, solana, stellar (required)
- `--network <name>` - Network name: mainnet, testnet, sepolia, etc. (required)
- `-s, --signer-id <id>` - Signer ID to use (required)
- `-n, --name <name>` - Display name (defaults to ID)
- `--paused` - Create in paused state
- `--min-balance <amount>` - Minimum balance policy (in smallest unit)
- `--fee-payment-strategy <strategy>` - Fee payment strategy (e.g., relayer)
- `--concurrent-transactions` - Allow concurrent transactions

```bash
# Create a Stellar relayer
oz-relayer relayer create my-relayer \
  --network-type stellar \
  --network testnet \
  --signer-id my-signer

# Create with policies (e.g., for channel funding)
oz-relayer relayer create channels-fund-backup \
  --network-type stellar \
  --network mainnet \
  --signer-id channels-fund-backup-signer \
  --min-balance 1000000 \
  --fee-payment-strategy relayer \
  --concurrent-transactions
```

Use `--page` and `--per-page` for pagination on `list`. Run `oz-relayer relayer --help` for all options.

### tx

Send and manage transactions.

```bash
oz-relayer tx send [options]                    # Send a transaction
oz-relayer tx status <id> -r <relayer>          # Get transaction status
oz-relayer tx list -r <relayer>                 # List transactions
oz-relayer tx show <id> -r <relayer>            # Show transaction details
oz-relayer tx cancel <id> -r <relayer>          # Cancel pending transaction
oz-relayer tx cancel-all -r <relayer>           # Cancel all pending
```

#### Sending Transactions

```bash
# Interactive mode - wizard guides you through
oz-relayer tx send

# Specify via flags
oz-relayer tx send -r my-relayer --to 0x742d35Cc... --value 0.1

# Send to another relayer by ID (resolves address automatically)
oz-relayer tx send -r funding-relayer --to-relayer target-relayer --value 1.0

# Wait for confirmation
oz-relayer tx send -r my-relayer --to 0x... --value 0.1 --wait
```

**Key options:**
- `-r, --relayer <id>` - Relayer to send from
- `--to <address>` - Destination address
- `--to-relayer <id>` - Send to another relayer (resolves address)
- `--value <amount>` - Amount in native units
- `--wait` - Wait for confirmation
- `--timeout <sec>` - Wait timeout (default: 120)

Run `oz-relayer tx send --help` for all options including EVM-specific flags.

### signer

Create and manage signers.

```bash
oz-relayer signer create <id> [options]  # Create a new signer
oz-relayer signer list                   # List all signers
oz-relayer signer show <id>              # Show signer details
```

**signer create options:**
- `-t, --type <type>` - Signer type: plain, vault, test (default: plain)
- `-k, --key <hex>` - Secret key (hex-encoded)
- `-g, --generate` - Generate random keypair

```bash
# Create with generated key
oz-relayer signer create my-signer --generate

# Create with explicit key
oz-relayer signer create my-signer --key <hex-secret>
```

### health

Check service connectivity.

```bash
oz-relayer health
```

### completions

Generate shell completion scripts.

```bash
# Bash (add to ~/.bashrc)
eval "$(oz-relayer completions bash)"

# Zsh (add to ~/.zshrc AFTER compinit)
eval "$(oz-relayer completions zsh)"

# Fish
oz-relayer completions fish > ~/.config/fish/completions/oz-relayer.fish
```

## Global Options

Available on all subcommands (place **after** the subcommand):

```bash
-p, --profile <name>    # Profile to use
    --url <url>         # Override relayer URL
    --api-key <key>     # Override API key
    --json              # Output as JSON
    --no-input          # Disable interactive prompts
-v, --verbose           # Show full errors (response body, stack trace)
```

**Example:**
```bash
oz-relayer relayer list --json -p production
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (API error, network failure) |
| 2 | Invalid usage (bad arguments, missing flags) |
| 3 | Authentication failure |
| 4 | Resource not found |
