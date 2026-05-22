# oz-channels CLI Reference

CLI for OpenZeppelin Channels plugin - Stellar/Soroban transaction submission via channel account pooling.

## Configuration

### Environment Variables

```bash
OZ_CHANNELS_URL=<url>
OZ_CHANNELS_API_KEY=<key>
OZ_CHANNELS_PLUGIN_ID=<id>
OZ_CHANNELS_ADMIN_SECRET=<secret>
OZ_CHANNELS_PROFILE=<name>
```

### Config Paths

- User: `~/.config/oz-channels/config.yaml`
- Project: `.oz-channels/config.yaml`

### Config Format

```yaml
default: production
profiles:
  default:
    url: http://localhost:8080
    api_key: client-key
    plugin_id: channels
    admin_secret: admin-key
    network: testnet              # testnet, mainnet, or futurenet
    test_account: test-account    # stellar CLI account name
    smoke_contract: CABC123...    # deployed smoke contract ID
  production:
    url: https://relayer.example.com
    api_key: prod-key
    plugin_id: channels
    network: mainnet
    protected: true               # require confirmation for write operations
```

### Protected Profiles

Profiles are auto-protected if their name contains: `prod`, `production`, `main`, `mainnet`, `live`.

Override with explicit `protected: true` or `protected: false` in the profile config.

Protected profiles show `(protected)` in `profile list` and require confirmation for write operations (bootstrap, channels set/add/remove).

## Commands

### Transaction Submission

```bash
# Submit signed XDR
oz-channels submit xdr <base64-xdr>
oz-channels submit xdr --file tx.xdr
cat tx.xdr | oz-channels submit xdr -

# Submit Soroban func+auth
oz-channels submit func-auth --func <base64> --auth <xdr1>,<xdr2>

# Options: --wait, --timeout <seconds>
```

### Channel Account Management

```bash
oz-channels channels list
oz-channels channels set <id1> <id2> ...
oz-channels channels add <id>
oz-channels channels remove <id>
```

### Fee Management

```bash
oz-channels fee usage <api-key>
oz-channels fee limit <api-key>
oz-channels fee set-limit <api-key> <limit>
oz-channels fee delete-limit <api-key>
```

### Profile Management

```bash
oz-channels profile init [name]
oz-channels profile list
oz-channels profile show [name]
oz-channels profile use <name>
oz-channels profile delete <name>
oz-channels profile path
```

### Smoke Tests

```bash
# Deploy smoke contract (testnet) or configure bundled ID (mainnet)
oz-channels smoke setup

# Run smoke tests
oz-channels smoke list                   # List available tests
oz-channels smoke run                    # Run all tests
oz-channels smoke run --test-id func-auth-no-auth  # Run specific test
oz-channels smoke run --concurrency 5    # Run parallel copies
oz-channels smoke run --debug            # Full response output
```

**Test IDs:** `xdr-payment`, `xdr-unsigned-soroban`, `func-auth-no-auth`, `func-auth-address-auth`

### Bootstrap Channel Accounts

```bash
# Provision channel accounts (range-based)
oz-channels bootstrap --to 5             # Create accounts 1-5
oz-channels bootstrap --to 100           # Create accounts 1-100
oz-channels bootstrap --from 50 --to 100 # Create accounts 50-100

# Scaling up existing pool
oz-channels bootstrap --from 101 --to 200  # Add 101-200 to existing 1-100

# Audit and preview modes
oz-channels bootstrap --to 100 --audit     # Report issues only
oz-channels bootstrap --to 100 --dry-run   # Preview changes

# Options
--from <n>                # Start slot (default: 1)
--to <n>                  # End slot (required)
--funding-relayer <id>    # Funding relayer (default: channels-fund)
--starting-balance <xlm>  # XLM per account (default: 2)
--prefix <string>         # Slot prefix (default: channel-)
--padding <n>             # Zero-padding (default: 4)
--concurrency <n>         # Parallel preflight ops (default: 10)
--delay-ms <n>            # Sequential op delay (default: 100)
--audit                   # Report issues only
--dry-run                 # Preview without changes
--verbose                 # Per-account output
--allow-gaps              # Allow gaps in slot sequence
```

### Utility Commands

```bash
oz-channels health
oz-channels completions <bash|zsh|fish>
```

## Global Options

```bash
-p, --profile <name>     # Profile to use
--url <url>              # Override URL
--api-key <key>          # Override API key
--plugin-id <id>         # Override plugin ID
--admin-secret <secret>  # Override admin secret
--json                   # JSON output
--no-input               # Disable prompts
```

## Exit Codes

- 0: Success
- 1: General error
- 2: Invalid usage
- 3: Authentication failure
- 4: Resource not found

## JSON Output Examples

### submit xdr

```json
{
  "transactionId": "tx-abc123",
  "hash": "abc123...",
  "status": "submitted"
}
```

### channels list

```json
{
  "relayerIds": ["channel-0001", "channel-0002"]
}
```

### fee usage

```json
{
  "consumed": 1000000,
  "limit": 10000000,
  "remaining": 9000000,
  "periodStartAt": "2024-01-01T00:00:00Z",
  "periodEndsAt": "2024-02-01T00:00:00Z"
}
```

### profile list

```json
{
  "profiles": [
    {
      "name": "default",
      "url": "http://localhost:8080",
      "default": true,
      "protected": false,
      "plugin_id": "channels",
      "has_admin_secret": true,
      "network": "testnet",
      "test_account": "test-account",
      "smoke_contract": "CABC123..."
    }
  ]
}
```

### smoke run

```json
{
  "results": [
    {
      "testId": "func-auth-no-auth",
      "passed": 5,
      "failed": 0,
      "avgDuration": 1234
    }
  ],
  "summary": {
    "total": 5,
    "passed": 5,
    "failed": 0
  }
}
```

### bootstrap (dry run)

```json
{
  "dryRun": true,
  "plan": {
    "total": 5,
    "toProvision": 5,
    "toFund": 5,
    "alreadyComplete": 0
  },
  "slots": ["channel-0001", "channel-0002", "channel-0003", "channel-0004", "channel-0005"],
  "fundingRelayer": "channels-fund",
  "startingBalance": 2,
  "network": "testnet"
}
```

### bootstrap (audit)

```json
{
  "audit": true,
  "total": 100,
  "existing": { "signers": 95, "relayers": 95, "funded": 90 },
  "missing": { "signers": 5, "relayers": 5, "unfunded": 5 },
  "issues": [
    { "slot": "channel-0096", "signerExists": false, "relayerExists": false, "funded": false }
  ],
  "existingConfig": ["channel-0001", "channel-0002", "..."]
}
```

### bootstrap (gap detected)

```json
{
  "error": "gap_detected",
  "gapStart": 11,
  "gapEnd": 19,
  "highestExisting": 10,
  "message": "Gap detected in slot sequence: 11-19. Use --allow-gaps to proceed."
}
```

### bootstrap (completed)

```json
{
  "summary": {
    "signersCreated": 150,
    "relayersCreated": 150,
    "accountsFunded": 150,
    "alreadyExisted": 50,
    "totalConfigured": 200,
    "errors": 0
  },
  "relayerIds": ["channel-0001", "channel-0002", "..."]
}
```

## Error Response Format

```json
{
  "error": "FEE_LIMIT_EXCEEDED",
  "message": "Fee budget exceeded for this period",
  "status": 429
}
```

## Common Error Codes

- `FEE_LIMIT_EXCEEDED` (429): Budget exceeded
- `LOCKED_CONFLICT` (409): Can't remove locked channel
- `INVALID_PARAMS` (400): Malformed request
- `AUTH_FAILED` (401/403): Authentication failure
