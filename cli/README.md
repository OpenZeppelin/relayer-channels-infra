# CLI Tools

CLI tools for managing and operating the Relayer Channels service.

## Packages

| Package | Description |
|---------|-------------|
| [oz-relayer](./packages/oz-relayer) | CLI for managing OpenZeppelin Relayer - send transactions, manage relayers, signers |
| [oz-channels](./packages/oz-channels) | CLI for OpenZeppelin Channels plugin - Stellar/Soroban transaction pooling |

## Quick Start

```bash
# From the repo root
cd cli

# Install dependencies
bun install

# Build all packages
bun run build

# Link CLIs globally
cd packages/oz-relayer && bun link
cd ../oz-channels && bun link

# Now available as:
oz-relayer --help
oz-channels --help
```

> Requires [Bun](https://bun.sh) runtime (Node.js 22+ compatible).

## Development

```bash
# Build all packages
bun run build

# Lint and format
bun run check

# Run tests
bun run test
```
