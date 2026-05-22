# oz-relayer CLI Reference

CLI for managing OpenZeppelin Relayer - a blockchain transaction relayer service supporting EVM, Solana, and Stellar networks.

## Command Overview

```
oz-relayer <command> [subcommand] [options]
```

**Important:** Options must be placed **after** the subcommand name:
```bash
# Correct
oz-relayer relayer list --json
oz-relayer tx list -r my-relayer --json

# Wrong (options before subcommand won't work)
oz-relayer --json relayer list
```

### Common Options

These options are available on most subcommands:

| Option | Description |
|--------|-------------|
| `-p, --profile <name>` | Profile to use |
| `--url <url>` | Override relayer URL |
| `--api-key <key>` | Override API key |
| `--json` | Output as JSON for scripting |
| `--no-input` | Disable interactive prompts |
| `-v, --verbose` | Verbose output (full errors, response bodies, stack traces) |

## Commands

### profile - Connection Management

```bash
oz-relayer profile init [name]      # Create profile interactively
oz-relayer profile list             # List all profiles
oz-relayer profile show [name]      # Show profile details (API key masked)
oz-relayer profile use <name>       # Set default profile
oz-relayer profile delete <name>    # Delete a profile
oz-relayer profile path             # Show config file paths
```

Profile commands support `--json` and `--no-input` options.

### relayer - Relayer Operations

```bash
oz-relayer relayer create <id> [opts]  # Create new relayer
oz-relayer relayer list                # List all relayers
oz-relayer relayer show <id>           # Full relayer details
oz-relayer relayer status <id>         # Operational status, pending tx count
oz-relayer relayer balance <id>        # Wallet balance and address
oz-relayer relayer pause <id>          # Pause transaction processing
oz-relayer relayer resume <id>         # Resume paused relayer
```

**relayer create options:**
- `-t, --network-type <type>` - evm, solana, stellar (required)
- `--network <name>` - mainnet, testnet, sepolia, etc. (required)
- `-s, --signer-id <id>` - Signer to use (required)
- `-n, --name <name>` - Display name (defaults to ID)
- `--paused` - Create paused
- `--min-balance <amount>` - Minimum balance policy
- `--fee-payment-strategy <strategy>` - Fee payment strategy (e.g., relayer)
- `--concurrent-transactions` - Allow concurrent transactions

**relayer list options:**
- `--page` (default: 1) - Page number
- `--per-page` (default: 10) - Items per page

### tx - Transaction Operations

```bash
oz-relayer tx send [options]        # Send transaction (interactive or flags)
oz-relayer tx status <id> -r <rel>  # Get transaction status
oz-relayer tx list -r <relayer>     # List transactions for relayer
oz-relayer tx show <id> -r <rel>    # Full transaction details
oz-relayer tx cancel <id> -r <rel>  # Cancel pending transaction
oz-relayer tx cancel-all -r <rel>   # Cancel all pending transactions
```

**tx send options:**
- `-r, --relayer <id>` - Relayer ID
- `--to <address>` - Destination address
- `--to-relayer <id>` - Destination relayer ID (resolves to relayer address)
- `--value <amount>` - Amount in native units (ETH/SOL/XLM)
- `--data <hex>` - Calldata (EVM only)
- `--gas-limit <num>` - Gas limit (EVM only)
- `--wait` - Block until confirmed
- `--timeout <sec>` - Wait timeout (default: 120)

**tx list options:**
- `-r, --relayer <id>` - Relayer ID (required)
- `--status <status>` - Filter by status (pending/sent/confirmed/failed)
- `--page` (default: 1) - Page number
- `--per-page` (default: 10) - Items per page

### signer - Signer Management

```bash
oz-relayer signer create <id> [opts]  # Create new signer
oz-relayer signer list                # List all signers
oz-relayer signer show <id>           # Show signer details
```

**signer create options:**
- `-t, --type <type>` - plain, vault, test (default: plain)
- `-k, --key <hex>` - Secret key (hex-encoded)
- `-g, --generate` - Generate random keypair

**signer list options:**
- `--page` (default: 1) - Page number
- `--per-page` (default: 10) - Items per page

### health - Service Health

```bash
oz-relayer health                   # Check if relayer service is healthy
```

### agent-docs - This Documentation

```bash
oz-relayer agent-docs               # Output this reference
```

### completions - Shell Completions

```bash
oz-relayer completions              # Show setup instructions
oz-relayer completions bash         # Bash completion script
oz-relayer completions zsh          # Zsh completion script
oz-relayer completions fish         # Fish completion script
```

Setup: `eval "$(oz-relayer completions bash)"` (or zsh) in shell config.

## Configuration

### Profile Storage

- User config: `~/.config/oz-relayer/config.yaml`
- Project config: `.oz-relayer/config.yaml` (takes precedence)

### Config File Format

```yaml
default: production
profiles:
  default:
    url: http://localhost:8080
    api_key: dev-key
    default_relayer: my-relayer
  production:
    url: https://relayer.example.com
    api_key: prod-key
    protected: true                # Require confirmation for write operations
```

### Protected Profiles

Profiles are auto-protected if their name contains: `prod`, `production`, `main`, `mainnet`, `live`.

Override with explicit `protected: true` or `protected: false` in the profile config.

Protected profiles show `(protected)` in `profile list` and require confirmation for write operations.

### Environment Variables

```bash
OZ_RELAYER_URL=<url>           # Override URL
OZ_RELAYER_API_KEY=<key>       # Override API key
OZ_RELAYER_PROFILE=<name>      # Override default profile
```

### Precedence

CLI flags → Environment variables → Project config → User config

## Common Workflows

### First-Time Setup

```bash
oz-relayer profile init
# Follow prompts: URL, API key, test connection
oz-relayer health
oz-relayer relayer list
```

### Send EVM Transaction

```bash
# Interactive
oz-relayer tx send

# Non-interactive
oz-relayer tx send -r my-relayer --to 0x... --value 0.1 --wait

# Send to another relayer by ID (resolves address automatically)
oz-relayer tx send -r funding-relayer --to-relayer target-relayer --value 1.0
```

### Check Transaction Status

```bash
oz-relayer tx status <tx-id> -r <relayer-id>
# Or get full details
oz-relayer tx show <tx-id> -r <relayer-id>
```

### Multiple Environments

```bash
oz-relayer profile init staging
oz-relayer profile init production
oz-relayer relayer list -p production
```

### JSON Output for Scripting

```bash
# List relayers and extract IDs
oz-relayer relayer list --json | jq '.[].id'

# List transactions as JSON
oz-relayer tx list -r my-relayer --json

# Check health
oz-relayer health --json | jq '.healthy'
```

### Pagination

```bash
# Get page 2 with 20 items per page
oz-relayer relayer list --page 2 --per-page 20

# Paginate transaction list
oz-relayer tx list -r my-relayer --page 1 --per-page 50
```

### Cancel Transactions

```bash
oz-relayer tx cancel <tx-id> -r <relayer> --no-input
oz-relayer tx cancel-all -r <relayer> --no-input
```

## Exit Codes

| Code | Meaning | Example |
|------|---------|---------|
| 0 | Success | Command completed |
| 1 | General error | API error, network failure |
| 2 | Invalid usage | Missing required flag |
| 3 | Auth failure | Invalid API key, 401/403 |
| 4 | Not found | Relayer/transaction doesn't exist |

## Error Handling

Errors include:
- HTTP status code
- Error code from API (if available)
- Request ID (for support)
- Human-readable message

Example:
```
✗ Authentication failed
  HTTP 401
  Code: UNAUTHORIZED
  Request ID: req_abc123
```

## Network Types

The relayer supports multiple networks. The `tx send` wizard adapts prompts based on network type:

- **EVM**: Ethereum-style addresses (0x...), optional data/gas-limit
- **Solana**: Base58 addresses, SOL amounts
- **Stellar**: G... addresses, XLM amounts

## Tips

1. Use `--json` for scripting and piping to `jq`
2. Set `default_relayer` in profile to skip `-r` flag
3. Use `--no-input` in CI/scripts to prevent hanging
4. The `--wait` flag polls until confirmed/failed (default 120s timeout)
5. Profile names are alphanumeric with dashes/underscores only
6. Options must come **after** the subcommand name
7. Use `-v/--verbose` to see full error details including response body and stack trace
