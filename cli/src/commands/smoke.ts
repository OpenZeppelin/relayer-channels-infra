import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeInvocation,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { defineCommand } from 'citty';
import pc from 'picocolors';
import { type CommandDeps, defaultDeps } from '../deps.js';
import { ProgressBar } from '../utils/progress.js';
import { deployContract } from '../utils/stellar.js';

/**
 * Dependencies needed by smoke commands.
 */
export type SmokeDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'updateProfile'
  | 'output'
  | 'success'
  | 'error'
  | 'handleApiError'
  | 'exitWithUsageError'
  | 'getStellarAccount'
  | 'createProgressBar'
>;

// Build func+auth payload for no_auth_bump (no auth required)
function buildNoAuthFuncPayload(contractId: string) {
  const contract = new Contract(contractId);
  const op = contract.call('no_auth_bump', xdr.ScVal.scvU32(42));
  const body = (op as any).body();
  const invokeOp = body.invokeHostFunctionOp();
  const func = invokeOp.hostFunction();
  const auth = invokeOp.auth() ?? [];
  return { func: func.toXDR('base64'), auth: auth.map((a: any) => a.toXDR('base64')) };
}

// Build signed self-payment XDR
async function buildSignedSelfPayment(
  rpcServer: rpc.Server,
  passphrase: string,
  address: string,
  keypair: Keypair,
): Promise<string> {
  const account = await rpcServer.getAccount(address);
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: passphrase })
    .addOperation(
      Operation.payment({
        source: address,
        destination: address,
        asset: Asset.native(),
        amount: '0.0000010',
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  return tx.toXDR();
}

// Build unsigned Soroban XDR with signed auth (smart wallet flow)
// The envelope is NOT signed, but auth entries ARE signed
async function buildUnsignedSorobanXdrWithAuth(
  contractId: string,
  passphrase: string,
  address: string,
  keypair: Keypair,
  rpcServer: rpc.Server,
): Promise<string> {
  const latest = await rpcServer.getLatestLedger();
  const validUntil = Number(latest.sequence) + 64;

  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId).toScAddress(),
    functionName: 'write_with_address_auth',
    args: [Address.fromString(address).toScVal(), xdr.ScVal.scvU32(999)],
  });

  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);
  const rootInv = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });

  // Sign the auth entry (simulates passkey signature)
  const signedAuthEntry = await authorizeInvocation(
    keypair,
    validUntil,
    rootInv,
    address,
    passphrase,
  );

  // Build the operation with signed auth
  const op = Operation.invokeHostFunction({
    func,
    auth: [signedAuthEntry],
  });

  // Use placeholder source - will be replaced by channel account
  const placeholder = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');

  const tx = new TransactionBuilder(placeholder, {
    fee: '100',
    networkPassphrase: passphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  // Return XDR WITHOUT signing the envelope
  return tx.toXDR();
}

// Build func+auth payload for write_with_address_auth (requires signed auth entry)
async function buildAddressAuthFuncPayload(
  contractId: string,
  passphrase: string,
  address: string,
  keypair: Keypair,
  rpcServer: rpc.Server,
): Promise<{ func: string; auth: string[] }> {
  const latest = await rpcServer.getLatestLedger();
  const validUntil = Number(latest.sequence) + 64;

  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId).toScAddress(),
    functionName: 'write_with_address_auth',
    args: [Address.fromString(address).toScVal(), xdr.ScVal.scvU32(777)],
  });

  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);
  const rootInv = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });

  const signedEntry = await authorizeInvocation(keypair, validUntil, rootInv, address, passphrase);

  return {
    func: func.toXDR('base64'),
    auth: [signedEntry.toXDR('base64')],
  };
}

// Default mainnet smoke contract (already deployed)
const MAINNET_SMOKE_CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// Global args that need to be defined on each subcommand (citty doesn't inherit from parent)
const globalArgs = {
  profile: {
    type: 'string' as const,
    alias: 'p',
    description: 'Profile to use',
  },
  url: {
    type: 'string' as const,
    description: 'Override channels URL',
  },
  'api-key': {
    type: 'string' as const,
    description: 'Override API key',
  },
  'plugin-id': {
    type: 'string' as const,
    description: 'Override plugin ID',
  },
  'admin-secret': {
    type: 'string' as const,
    description: 'Override admin secret',
  },
  json: {
    type: 'boolean' as const,
    description: 'Output as JSON',
    default: false,
  },
  'no-input': {
    type: 'boolean' as const,
    description: 'Disable interactive prompts',
    default: false,
  },
};

function requireConfig(deps: SmokeDeps, args: Record<string, unknown>) {
  const config = deps.resolveConfig(
    args as {
      profile?: string;
      url?: string;
      'api-key'?: string;
      'plugin-id'?: string;
      'admin-secret'?: string;
    },
  );
  if (!config) {
    deps.exitWithUsageError(
      'No configuration found. Run `oz-channels profile init` or set OZ_CHANNELS_URL and OZ_CHANNELS_API_KEY environment variables.',
    );
  }
  return config;
}

interface TestResult {
  testId: string;
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  transactionId?: string;
  hash?: string;
}

async function runTest(
  testId: string,
  name: string,
  testFn: () => Promise<{ transactionId?: string | null; hash?: string | null }>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await testFn();
    return {
      testId,
      name,
      passed: true,
      duration: Date.now() - start,
      transactionId: result.transactionId || undefined,
      hash: result.hash || undefined,
    };
  } catch (err) {
    return {
      testId,
      name,
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Get the directory where the CLI is installed
function getAssetsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const distDir = dirname(currentFile);
  return join(distDir, 'assets');
}

function createSetupCommand(deps: SmokeDeps) {
  return defineCommand({
    meta: {
      name: 'setup',
      description: 'Deploy smoke contract and configure profile',
    },
    args: {
      ...globalArgs,
    },
    async run({ args }) {
      const json = args.json;
      const config = requireConfig(deps, args);

      if (!config.testAccount) {
        deps.exitWithUsageError('No test_account in profile. Run `oz-channels profile init` first.');
      }

      const account = deps.getStellarAccount(config.testAccount);
      if (!account) {
        deps.exitWithUsageError(
          `Stellar account '${config.testAccount}' not found. Generate with: stellar keys generate ${config.testAccount} --network ${config.network || 'testnet'}`,
        );
      }

      const network = config.network || 'testnet';

      // Mainnet: use bundled contract ID (no deployment)
      if (network === 'mainnet') {
        deps.updateProfile(config.profileName, { smoke_contract: MAINNET_SMOKE_CONTRACT });
        if (json) {
          deps.output({ contractId: MAINNET_SMOKE_CONTRACT, deployed: false }, { json: true });
        } else {
          deps.success(`Using existing mainnet contract: ${MAINNET_SMOKE_CONTRACT}`);
        }
        return;
      }

      // Testnet: deploy fresh contract (requires WASM)
      const assetsDir = getAssetsDir();
      const wasmPath = join(assetsDir, 'smoke_contract.wasm');

      if (!existsSync(wasmPath)) {
        deps.exitWithUsageError(
          `Smoke contract WASM not found at ${wasmPath}. Ensure the CLI was built correctly.`,
        );
      }

      if (!json) {
        console.log('Deploying smoke contract...');
      }

      try {
        const contractId = deployContract(wasmPath, config.testAccount, network);
        deps.updateProfile(config.profileName, { smoke_contract: contractId });

        if (json) {
          deps.output({ contractId, deployed: true }, { json: true });
        } else {
          deps.success(`Smoke contract deployed: ${contractId}`);
        }
      } catch (err) {
        deps.exitWithUsageError(
          `Failed to deploy contract: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}

function createListCommand(deps: SmokeDeps) {
  return defineCommand({
    meta: {
      name: 'list',
      description: 'List available smoke tests',
    },
    args: {
      json: {
        type: 'boolean' as const,
        description: 'Output as JSON',
        default: false,
      },
    },
    run({ args }) {
      const allTests = [
        { id: 'xdr-payment', description: 'Signed XDR self-payment' },
        {
          id: 'xdr-unsigned-soroban',
          description: 'Unsigned Soroban XDR with signed auth (smart wallet flow)',
        },
        { id: 'func-auth-no-auth', description: 'func+auth: no_auth_bump(42)' },
        { id: 'func-auth-address-auth', description: 'func+auth: write_with_address_auth(777)' },
      ];

      if (args.json) {
        deps.output({ tests: allTests }, { json: true });
      } else {
        console.log('Available smoke tests:\n');
        for (const test of allTests) {
          console.log(`  ${test.id.padEnd(24)} ${test.description}`);
        }
      }
    },
  });
}

function createRunCommand(deps: SmokeDeps) {
  return defineCommand({
    meta: {
      name: 'run',
      description: 'Run smoke tests',
    },
    args: {
      ...globalArgs,
      'test-id': {
        type: 'string',
        description: 'Run specific test (use `smoke list` to see available tests)',
      },
      concurrency: {
        type: 'string',
        description: 'Parallel copies per test',
        default: '1',
      },
      debug: {
        type: 'boolean',
        description: 'Full response output',
        default: false,
      },
    },
    async run({ args }) {
      const json = args.json;
      const debug = args.debug;

      // All available tests
      const allTests = [
        'xdr-payment',
        'xdr-unsigned-soroban',
        'func-auth-no-auth',
        'func-auth-address-auth',
      ];

      const config = requireConfig(deps, args);
      const client = deps.createClient(config);

      if (!config.testAccount) {
        deps.exitWithUsageError('No test_account in profile. Run `oz-channels profile init` first.');
      }

      if (!config.smokeContract) {
        deps.exitWithUsageError('No smoke_contract in profile. Run `oz-channels smoke setup` first.');
      }

      const account = deps.getStellarAccount(config.testAccount);
      if (!account) {
        deps.exitWithUsageError(`Stellar account '${config.testAccount}' not found.`);
      }

      const concurrency = Number(args.concurrency) || 1;
      const network = config.network || 'testnet';
      const contractId = config.smokeContract;

      // Set up RPC server and keypair for tests that need them
      const rpcUrl =
        network === 'mainnet' ? 'https://soroban.stellar.org' : 'https://soroban-testnet.stellar.org';
      const rpcServer = new rpc.Server(rpcUrl);
      const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
      const keypair = Keypair.fromSecret(account.secretKey);

      const testIds = args['test-id'] ? [args['test-id']] : allTests;

      if (!json) {
        console.log(pc.bold('\noz-channels smoke test'));
        console.log(pc.cyan(`Profile: ${config.profileName}\n`));
        console.log(
          `${pc.bold('Account:')} ${account.publicKey.slice(0, 8)}...${account.publicKey.slice(-4)}`,
        );
        console.log(`${pc.bold('Contract:')} ${contractId.slice(0, 8)}...${contractId.slice(-4)}`);
        console.log(`${pc.bold('Concurrency:')} ${concurrency}`);
        console.log();
      }

      interface TestResultGroup {
        testId: string;
        passed: number;
        failed: number;
        avgDuration: number;
        runs: TestResult[];
        errors: string[];
      }

      const groupedResults: TestResultGroup[] = [];

      for (const testId of testIds) {
        const totalRuns = concurrency;

        if (!json && concurrency > 1) {
          console.log(`Running ${testId} (${concurrency} copies)...`);
        } else if (!json) {
          process.stdout.write(`Running ${testId}... `);
        }

        const runSingleTest = async (): Promise<TestResult> => {
          switch (testId) {
            case 'xdr-payment':
              return runTest(testId, 'Signed XDR self-payment', async () => {
                const xdrPayload = await buildSignedSelfPayment(
                  rpcServer,
                  passphrase,
                  account.publicKey,
                  keypair,
                );
                const response = await client.submitXdr({ xdr: xdrPayload });
                return {
                  transactionId: response.transactionId,
                  hash: response.hash,
                };
              });

            case 'xdr-unsigned-soroban':
              return runTest(testId, 'Unsigned Soroban XDR with signed auth', async () => {
                const unsignedXdr = await buildUnsignedSorobanXdrWithAuth(
                  contractId,
                  passphrase,
                  account.publicKey,
                  keypair,
                  rpcServer,
                );
                const response = await client.submitXdr({ xdr: unsignedXdr });
                return {
                  transactionId: response.transactionId,
                  hash: response.hash,
                };
              });

            case 'func-auth-no-auth':
              return runTest(testId, 'no_auth_bump(42)', async () => {
                const payload = buildNoAuthFuncPayload(contractId);
                const response = await client.submitFuncAuth({
                  func: payload.func,
                  auth: payload.auth,
                });
                return {
                  transactionId: response.transactionId,
                  hash: response.hash,
                };
              });

            case 'func-auth-address-auth':
              return runTest(testId, 'write_with_address_auth(777)', async () => {
                const payload = await buildAddressAuthFuncPayload(
                  contractId,
                  passphrase,
                  account.publicKey,
                  keypair,
                  rpcServer,
                );
                const response = await client.submitFuncAuth({
                  func: payload.func,
                  auth: payload.auth,
                });
                return {
                  transactionId: response.transactionId,
                  hash: response.hash,
                };
              });

            default:
              return {
                testId,
                name: 'Unknown test',
                passed: false,
                duration: 0,
                error: `Unknown test ID: ${testId}`,
              };
          }
        };

        let progress: ProgressBar | null = null;
        if (!json && concurrency > 1) {
          progress = deps.createProgressBar(totalRuns);
        }

        const promises = Array(concurrency)
          .fill(null)
          .map(async () => {
            const result = await runSingleTest();
            progress?.increment();
            return result;
          });

        const results = await Promise.all(promises);
        progress?.done();

        const passed = results.filter((r) => r.passed).length;
        const failed = results.filter((r) => !r.passed).length;
        const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
        const errors = results.filter((r) => !r.passed && r.error).map((r) => r.error as string);

        groupedResults.push({
          testId,
          passed,
          failed,
          avgDuration,
          runs: results,
          errors: [...new Set(errors)], // dedupe errors
        });

        // Print inline result for single runs
        if (!json && concurrency === 1) {
          const result = results[0];
          if (result.passed) {
            console.log(pc.green(`passed ${result.duration}ms`));
            if (debug && result.transactionId) {
              console.log(pc.dim(`  Transaction: ${result.transactionId}`));
            }
            if (debug && result.hash) {
              console.log(pc.dim(`  Hash: ${result.hash}`));
            }
          } else {
            console.log(pc.red(`failed: ${result.error}`));
          }
        }
      }

      // Print summary for concurrent runs
      const totalPassed = groupedResults.reduce((sum, g) => sum + g.passed, 0);
      const totalFailed = groupedResults.reduce((sum, g) => sum + g.failed, 0);
      const totalRuns = totalPassed + totalFailed;

      if (json) {
        deps.output(
          {
            results: groupedResults.map((g) => ({
              testId: g.testId,
              passed: g.passed,
              failed: g.failed,
              avgDuration: Math.round(g.avgDuration),
              runs: debug ? g.runs : undefined,
            })),
            summary: {
              total: totalRuns,
              passed: totalPassed,
              failed: totalFailed,
            },
          },
          { json: true },
        );
      } else if (concurrency > 1 || testIds.length > 1) {
        console.log('\nResults:');
        for (const group of groupedResults) {
          if (group.failed === 0) {
            console.log(
              `  ${pc.green('\u2713')} ${group.testId} (${group.passed}/${group.passed + group.failed} passed, avg ${Math.round(group.avgDuration)}ms)`,
            );
          } else {
            console.log(
              `  ${pc.red('\u2717')} ${group.testId} (${group.passed}/${group.passed + group.failed} passed)`,
            );
            for (const error of group.errors) {
              console.log(pc.dim(`    - ${error}`));
            }
          }
        }
        console.log();
        if (totalFailed === 0) {
          deps.success(`All ${totalPassed} test(s) passed`);
        } else {
          deps.error(`${totalFailed} of ${totalRuns} test(s) failed`);
          process.exit(1);
        }
      } else {
        // Single test, single run - already printed inline
        if (totalFailed > 0) {
          process.exit(1);
        }
      }
    },
  });
}

/**
 * Create the smoke command with injected dependencies.
 */
export function createSmokeCommand(deps: SmokeDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'smoke',
      description: 'Run smoke tests against the channels service',
    },
    subCommands: {
      setup: createSetupCommand(deps),
      list: createListCommand(deps),
      run: createRunCommand(deps),
    },
  });
}

/**
 * Default smoke command instance for production use.
 */
export const smokeCommand = createSmokeCommand();
