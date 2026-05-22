# Project Conventions

## Tech Stack

- **Runtime**: Bun-first (test Node.js compatibility secondarily)
- **Package manager**: Bun
- **Monorepo**: Turborepo (use `--cwd` for workspace-specific deps)
- **Linting/formatting**: Biome
- **TypeScript**: Strict mode, ES2022 target

## CLI Development

- **Framework**: citty (lightweight, good TypeScript support)
- **Interactive prompts**: Native Node readline (clack/inquirer had Unicode issues with Ghostty)
- **Config format**: YAML
- **Colors**: picocolors
- **Testing**: Bun's built-in test runner

## Code Style

- Self-contained packages (no shared code between CLIs for now)
- Each CLI has its own API client wrapper around the SDK
- Developer-friendly error output by default (HTTP status, error codes, request IDs)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (API error, network failure) |
| 2 | Invalid usage (bad arguments, missing flags) |
| 3 | Authentication failure |
| 4 | Resource not found |

## Config Precedence

CLI flags > Environment variables > Project config > User config

## Commands

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Lint and format
./node_modules/.bin/biome check --write .

# Run tests
bun run test

# Link a CLI globally for testing
cd packages/oz-relayer && bun link
```

## Adding New Commands

1. Create command file in `src/commands/`
2. Export command using `defineCommand` from citty
3. Add `...globalArgs` to each subcommand (citty doesn't inherit args from parent)
4. Add to subCommands in `src/index.ts`
5. Update documentation (see below)

## Documentation

After making CLI changes, always update documentation:

- `packages/<cli>/README.md` - User-facing docs
- `packages/<cli>/AGENTS.md` - LLM reference (bundled in dist via build)

When updating docs:
- Consider the larger context - reorganize sections if needed rather than just appending
- Keep examples accurate with actual CLI behavior
- Verify JSON output examples match real output structure
- Run `bun run build` to bundle updated AGENTS.md into dist

## SDK Usage

- oz-relayer uses `@openzeppelin/relayer-sdk`
- Transactions are on `RelayersApi`, not a separate TransactionsApi
- Health check is `HealthApi.health()`
