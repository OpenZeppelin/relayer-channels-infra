import { Configuration, RelayersApi, SignersApi } from '@openzeppelin/relayer-sdk';
import type { ApiResponseRelayerResponseData } from '@openzeppelin/relayer-sdk';
import { defineCommand } from 'citty';
import pc from 'picocolors';
import type { CommandDeps } from '../../deps.js';
import { defaultDeps } from '../../deps.js';
import { ProgressBar } from '../../utils/progress.js';
import type { NetworkName } from '../../utils/stellar.js';
import { type AccountToFund, fundAccounts } from './funding.js';
import { type RelayerClient, detectGaps, runPreflight } from './preflight.js';
import { provisionAccounts } from './provision.js';
import type { AccountAudit, BootstrapOptions, BootstrapSummary } from './types.js';

/**
 * Dependencies needed by bootstrap command.
 */
export type BootstrapDeps = Pick<
  CommandDeps,
  | 'resolveConfig'
  | 'createClient'
  | 'output'
  | 'success'
  | 'warn'
  | 'info'
  | 'exitWithUsageError'
  | 'confirmProtectedOperation'
  | 'promptConfirm'
  | 'closePrompts'
  | 'checkAccountFunded'
  | 'fetchCompetitiveFee'
>;

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

function requireConfig(deps: BootstrapDeps, args: Record<string, unknown>) {
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

function requireAdminSecret(deps: BootstrapDeps, config: ReturnType<typeof requireConfig>) {
  if (!config.adminSecret) {
    deps.exitWithUsageError(
      'Admin secret is required for this operation. Set it in your profile or use --admin-secret.',
    );
  }
}

function createRelayerClient(config: ReturnType<typeof requireConfig>): RelayerClient {
  const sdkConfig = new Configuration({
    basePath: config.url.replace(/\/$/, ''),
    accessToken: config.apiKey,
  });
  return {
    signers: new SignersApi(sdkConfig),
    relayers: new RelayersApi(sdkConfig),
  };
}

async function tryGetRelayer(
  relayerClient: RelayerClient,
  relayerId: string,
): Promise<ApiResponseRelayerResponseData | null> {
  try {
    const response = await relayerClient.relayers.getRelayer(relayerId);
    return response.data.data || null;
  } catch (err) {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { status?: number } }).response;
      if (response?.status === 404) {
        return null;
      }
    }
    throw err;
  }
}

/**
 * List all relayers from the relayer service (handles pagination).
 * Filters to only include relayers matching the given prefix.
 */
async function listAllRelayersWithPrefix(
  relayerClient: RelayerClient,
  prefix: string,
): Promise<string[]> {
  const relayerIds: string[] = [];
  const perPage = 100;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await relayerClient.relayers.listRelayers(page, perPage);
    const relayers = response.data.data || [];

    for (const relayer of relayers) {
      if (relayer.id?.startsWith(prefix)) {
        relayerIds.push(relayer.id);
      }
    }

    hasMore = relayers.length === perPage;
    page++;
  }

  return relayerIds.sort();
}

function generateSlotNames(from: number, to: number, prefix: string, padding: number): string[] {
  const slots: string[] = [];
  for (let i = from; i <= to; i++) {
    slots.push(`${prefix}${String(i).padStart(padding, '0')}`);
  }
  return slots;
}

/**
 * Create the bootstrap command with injected dependencies.
 */
export function createBootstrapCommand(deps: BootstrapDeps = defaultDeps) {
  return defineCommand({
    meta: {
      name: 'bootstrap',
      description: 'Provision channel accounts for the service',
    },
    args: {
      ...globalArgs,
      from: {
        type: 'string',
        description: 'Starting slot number (inclusive)',
        default: '1',
      },
      to: {
        type: 'string',
        description: 'Ending slot number (inclusive)',
        required: true,
      },
      'funding-relayer': {
        type: 'string',
        description: 'Relayer ID for funding new accounts',
        default: 'channels-fund',
      },
      'starting-balance': {
        type: 'string',
        description: 'XLM per account',
        default: '2',
      },
      prefix: {
        type: 'string',
        description: 'Slot prefix',
        default: 'channel-',
      },
      padding: {
        type: 'string',
        description: 'Zero-padding for slot numbers',
        default: '4',
      },
      concurrency: {
        type: 'string',
        description: 'Parallel operations during preflight',
        default: '10',
      },
      'delay-ms': {
        type: 'string',
        description: 'Delay between sequential operations',
        default: '100',
      },
      audit: {
        type: 'boolean',
        description: 'Audit-only mode (report issues, no changes)',
        default: false,
      },
      'dry-run': {
        type: 'boolean',
        description: 'Show plan without making changes',
        default: false,
      },
      verbose: {
        type: 'boolean',
        description: 'Show detailed per-account output',
        default: false,
      },
      'allow-gaps': {
        type: 'boolean',
        description: 'Allow gaps in slot sequence',
        default: false,
      },
    },
    async run({ args }) {
      const json = args.json;
      const dryRun = args['dry-run'];
      const audit = args.audit;
      const verbose = args.verbose;
      const noInput = args['no-input'];
      const allowGaps = args['allow-gaps'];
      const config = requireConfig(deps, args);
      requireAdminSecret(deps, config);

      // Check for protected profile before write operation (skip for audit/dry-run)
      if (config.isProtected && !audit && !dryRun) {
        const confirmed = await deps.confirmProtectedOperation({
          profileName: config.profileName,
          operation: 'bootstrap channel accounts',
          summary: `Slots ${args.from} to ${args.to}`,
          noInput: Boolean(noInput),
        });
        if (!confirmed) {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      // Parse numeric args
      const from = Number(args.from);
      const to = Number(args.to);
      const startingBalance = Number(args['starting-balance'] || '2');
      const padding = Number(args.padding || '4');
      const concurrency = Number(args.concurrency || '10');
      const delayMs = Number(args['delay-ms'] || '100');
      const prefix = args.prefix || 'channel-';
      const fundingRelayerId = args['funding-relayer'] || 'channels-fund';
      const network = (config.network || 'testnet') as NetworkName;

      // Validate args
      if (Number.isNaN(from) || from < 1) {
        deps.exitWithUsageError('--from must be a positive number');
      }
      if (Number.isNaN(to) || to < from) {
        deps.exitWithUsageError('--to must be >= --from');
      }
      if (Number.isNaN(startingBalance) || startingBalance <= 0) {
        deps.exitWithUsageError('--starting-balance must be a positive number');
      }
      if (Number.isNaN(concurrency) || concurrency < 1) {
        deps.exitWithUsageError('--concurrency must be a positive number');
      }
      if (Number.isNaN(delayMs) || delayMs < 0) {
        deps.exitWithUsageError('--delay-ms must be a non-negative number');
      }
      if (Number.isNaN(padding) || padding < 1) {
        deps.exitWithUsageError('--padding must be a positive number');
      }

      const options: BootstrapOptions = {
        from,
        to,
        fundingRelayer: fundingRelayerId,
        startingBalance,
        prefix,
        padding,
        concurrency,
        delayMs,
        audit,
        dryRun,
        verbose,
        json,
        allowGaps,
        network,
        noInput,
      };

      const relayerClient = createRelayerClient(config);
      const channelsClient = deps.createClient(config);
      const total = to - from + 1;
      const slotNames = generateSlotNames(from, to, prefix, padding);

      // Print header
      if (!json) {
        console.log(pc.bold('\noz-channels bootstrap'));
        console.log(pc.cyan(`Profile: ${config.profileName}\n`));
        console.log(`${pc.bold('Range:')} ${from} to ${to} (${total} accounts)`);
        console.log(`${pc.bold('Prefix:')} ${prefix}`);
        console.log(`${pc.bold('Funding relayer:')} ${fundingRelayerId}`);
        console.log(`${pc.bold('Starting balance:')} ${startingBalance} XLM`);
        console.log(`${pc.bold('Network:')} ${network}`);
        if (dryRun) {
          console.log(pc.yellow('\n[DRY RUN] No changes will be made\n'));
        } else if (audit) {
          console.log(pc.yellow('\n[AUDIT] Report only, no changes\n'));
        }
        console.log();
      }

      // Step 1: Validate funding relayer
      let fundingRelayerData: ApiResponseRelayerResponseData | null = null;
      try {
        fundingRelayerData = await tryGetRelayer(relayerClient, fundingRelayerId);
        if (!fundingRelayerData) {
          deps.exitWithUsageError(`Funding relayer '${fundingRelayerId}' not found`);
        }
      } catch {
        deps.exitWithUsageError(`Failed to fetch funding relayer '${fundingRelayerId}'`);
      }

      const fundingAddress = fundingRelayerData?.address;
      if (!fundingAddress) {
        deps.exitWithUsageError('Funding relayer has no address');
      }

      // Check funding balance
      const fundingAccountStatus = await deps.checkAccountFunded(fundingAddress, network);
      const fundingBalance = fundingAccountStatus.balance
        ? Number(fundingAccountStatus.balance)
        : 0;
      const maxRequiredXlm = total * startingBalance;

      if (!json) {
        console.log(`${pc.bold('Funding balance:')} ${fundingBalance.toFixed(2)} XLM`);
        console.log(`${pc.bold('Max required:')} ${maxRequiredXlm} XLM (if all accounts new)`);
        if (fundingBalance >= maxRequiredXlm) {
          console.log(pc.green('  Sufficient balance'));
        } else {
          console.log(pc.yellow('  May be insufficient if many accounts need funding'));
        }
        console.log();
      }

      // Step 2: Run preflight audit
      if (!json) {
        console.log(pc.bold('Auditing accounts...'));
      }

      const progressBar = !json && !verbose ? new ProgressBar(total, { label: 'Auditing' }) : null;

      const preflight = await runPreflight(slotNames, {
        relayerClient,
        channelsClient,
        network,
        concurrency,
        verbose,
        onProgress: progressBar ? (completed, total) => progressBar.update(completed) : undefined,
      });

      progressBar?.done();

      // Step 3: Check for gaps
      const gapResult = detectGaps(from, preflight, prefix);

      if (gapResult.hasGap && !allowGaps) {
        if (json) {
          deps.output(
            {
              error: 'gap_detected',
              gapStart: gapResult.gapStart,
              gapEnd: gapResult.gapEnd,
              highestExisting: gapResult.highestExisting,
              message: `Gap detected in slot sequence: ${gapResult.gapStart}-${gapResult.gapEnd}. Use --allow-gaps to proceed.`,
            },
            { json: true },
          );
        } else {
          console.log();
          console.log(pc.red('Gap detected in slot sequence!'));
          console.log(`  Missing slots: ${gapResult.gapStart} to ${gapResult.gapEnd}`);
          console.log(`  Highest existing: ${gapResult.highestExisting}`);
          console.log();
          console.log('Use --allow-gaps to proceed anyway, or bootstrap the missing range first.');
        }
        process.exit(1);
      }

      // Print preflight summary
      if (!json) {
        console.log();
        console.log(pc.bold('Preflight results:'));
        console.log(
          `  Existing: ${preflight.existing.signers} signers, ${preflight.existing.relayers} relayers, ${preflight.existing.funded} funded`,
        );
        console.log(
          `  Missing: ${preflight.missing.signers} signers, ${preflight.missing.relayers} relayers, ${preflight.missing.unfunded} unfunded`,
        );
        if (gapResult.hasGap) {
          console.log(
            pc.yellow(`  Gap: ${gapResult.gapStart}-${gapResult.gapEnd} (--allow-gaps enabled)`),
          );
        }
        console.log();
      }

      // Audit mode: report and exit
      if (audit) {
        const issues = preflight.accounts.filter(
          (a) => !a.signerExists || !a.relayerExists || !a.onChainFunded || a.error,
        );

        if (json) {
          deps.output(
            {
              audit: true,
              total,
              existing: preflight.existing,
              missing: preflight.missing,
              issues: issues.map((i) => ({
                slot: i.slot,
                signerExists: i.signerExists,
                relayerExists: i.relayerExists,
                funded: i.onChainFunded,
                error: i.error,
              })),
              existingConfig: preflight.existingConfigIds,
            },
            { json: true },
          );
        } else {
          if (issues.length === 0) {
            deps.success('All accounts are fully provisioned');
          } else {
            console.log(pc.bold(`Issues found: ${issues.length}`));
            for (const issue of issues.slice(0, 20)) {
              const problems: string[] = [];
              if (!issue.signerExists) problems.push('no signer');
              if (!issue.relayerExists) problems.push('no relayer');
              if (issue.relayerExists && !issue.onChainFunded) problems.push('not funded');
              if (issue.error) problems.push(`error: ${issue.error}`);
              console.log(`  ${issue.slot}: ${problems.join(', ')}`);
            }
            if (issues.length > 20) {
              console.log(pc.dim(`  ... and ${issues.length - 20} more`));
            }
            console.log();
            console.log('Run without --audit to fix these issues.');
          }
        }
        return;
      }

      // Dry run: show plan and exit
      if (dryRun) {
        const toProvision = preflight.accounts.filter((a) => !a.signerExists || !a.relayerExists);
        // Accounts needing funding: existing unfunded + all to-be-provisioned (they'll need funding too)
        const existingUnfunded = preflight.accounts.filter(
          (a) => a.relayerExists && !a.onChainFunded,
        );
        const toFundCount = existingUnfunded.length + toProvision.length;

        if (json) {
          deps.output(
            {
              dryRun: true,
              plan: {
                total,
                toProvision: toProvision.length,
                toFund: toFundCount,
                alreadyComplete: preflight.existing.funded,
              },
              slots: slotNames,
              fundingRelayer: fundingRelayerId,
              startingBalance,
              network,
            },
            { json: true },
          );
        } else {
          console.log(pc.bold('Plan:'));
          console.log(`  Accounts to provision: ${toProvision.length}`);
          console.log(`  Accounts to fund: ${toFundCount}`);
          console.log(`  Already complete: ${preflight.existing.funded}`);
          console.log();
          if (toProvision.length > 0) {
            console.log('Slots to provision:');
            for (const slot of toProvision.slice(0, 10)) {
              console.log(`  ${slot.slot}`);
            }
            if (toProvision.length > 10) {
              console.log(pc.dim(`  ... and ${toProvision.length - 10} more`));
            }
          }
          console.log();
          deps.info('No changes made (dry run)');
        }
        return;
      }

      // Confirmation prompt
      const toProvision = preflight.accounts.filter((a) => !a.signerExists || !a.relayerExists);
      const needsFunding = preflight.accounts.filter(
        (a) => (a.relayerExists || toProvision.some((p) => p.slot === a.slot)) && !a.onChainFunded,
      );

      if (!noInput && !json && (toProvision.length > 0 || needsFunding.length > 0)) {
        console.log(pc.bold('Changes to make:'));
        console.log(`  Provision: ${toProvision.length} accounts`);
        console.log(
          `  Fund: ${needsFunding.length} accounts (~${needsFunding.length * startingBalance} XLM)`,
        );
        console.log();

        const confirm = await deps.promptConfirm('Proceed with bootstrap?');
        deps.closePrompts();
        if (!confirm) {
          console.log('Bootstrap cancelled.');
          return;
        }
        console.log();
      }

      const summary: BootstrapSummary = {
        signersCreated: 0,
        relayersCreated: 0,
        accountsFunded: 0,
        alreadyExisted: preflight.existing.funded,
        totalConfigured: 0,
        errors: [],
      };

      // Step 4: Provision accounts (signers + relayers)
      if (toProvision.length > 0) {
        if (!json) {
          console.log(pc.bold('Provisioning accounts...'));
        }

        const provisionProgress =
          !json && !verbose ? new ProgressBar(toProvision.length, { label: 'Provisioning' }) : null;

        const provisionResults = await provisionAccounts(toProvision, {
          relayerClient,
          network,
          delayMs,
          verbose,
          onProgress: provisionProgress
            ? (completed, total) => provisionProgress.update(completed)
            : undefined,
        });

        provisionProgress?.done();

        // Update summary and preflight with new addresses
        for (const result of provisionResults) {
          if (result.signerCreated) summary.signersCreated++;
          if (result.relayerCreated) summary.relayersCreated++;
          if (result.error) {
            summary.errors.push(`${result.slot}: ${result.error}`);
          }
          // Update preflight data with new addresses
          const account = preflight.accounts.find((a) => a.slot === result.slot);
          if (account && result.relayerAddress) {
            account.relayerAddress = result.relayerAddress;
            account.relayerExists = true;
            account.signerExists = true;
          }
        }

        if (!json) {
          console.log(
            `  Created: ${summary.signersCreated} signers, ${summary.relayersCreated} relayers`,
          );
          if (summary.errors.length > 0) {
            console.log(pc.red(`  Errors: ${summary.errors.length}`));
          }
          console.log();
        }
      }

      // Step 5: Fund accounts
      const toFund: AccountToFund[] = preflight.accounts
        .filter(
          (a): a is AccountAudit & { relayerAddress: string } =>
            a.relayerExists && !!a.relayerAddress && !a.onChainFunded,
        )
        .map((a) => ({ slot: a.slot, address: a.relayerAddress }));

      // Track successfully funded slots
      const successfullyFunded = new Set<string>();

      if (toFund.length > 0) {
        if (!json) {
          console.log(pc.bold('Funding accounts...'));
          process.stdout.write('  Fetching competitive fee... ');
        }

        const fee = await deps.fetchCompetitiveFee(network);

        if (!json) {
          console.log(pc.green(`${fee} stroops`));
        }

        // Check balance is sufficient
        const requiredXlm = toFund.length * startingBalance;
        if (fundingBalance < requiredXlm) {
          if (!json) {
            console.log(
              pc.red(
                `  Insufficient balance: ${fundingBalance.toFixed(2)} XLM available, ${requiredXlm} XLM required`,
              ),
            );
          }
          summary.errors.push(
            `Insufficient funding balance: ${fundingBalance.toFixed(2)} < ${requiredXlm}`,
          );
        } else {
          const fundProgress =
            !json && !verbose ? new ProgressBar(toFund.length, { label: 'Funding' }) : null;

          const fundResults = await fundAccounts(toFund, {
            relayerClient,
            fundingRelayer: fundingRelayerId,
            fundingAddress,
            startingBalance,
            network,
            fee,
            delayMs,
            verbose,
            onProgress: fundProgress
              ? (completed, total) => fundProgress.update(completed)
              : undefined,
          });

          fundProgress?.done();

          for (const result of fundResults) {
            if (result.funded) {
              successfullyFunded.add(result.slot);
              if (!result.alreadyFunded) {
                summary.accountsFunded++;
              } else {
                summary.alreadyExisted++;
              }
            }
            if (result.error) {
              summary.errors.push(`${result.slot}: ${result.error}`);
            }
          }

          if (!json) {
            console.log(`  Funded: ${summary.accountsFunded} accounts`);
            if (summary.errors.length > 0) {
              console.log(pc.red(`  Errors: ${summary.errors.length}`));
            }
            console.log();
          }
        }
      }

      // Step 6: Update channels plugin config
      // Query relayer service for all relayers with matching prefix (source of truth)
      // For in-range relayers: only include if verified funded
      // For out-of-range relayers: trust they were funded by previous bootstrap
      if (!json) {
        process.stdout.write('Syncing channels config from relayer... ');
      }

      let allConfigIds: string[] = [];
      try {
        const allRelayers = await listAllRelayersWithPrefix(relayerClient, prefix);
        const inRangeSlots = new Set(slotNames);

        // Funded in-range slots: either already funded (preflight) or just funded this run
        const fundedInRangeSet = new Set(
          preflight.accounts
            .filter((a) => a.onChainFunded || successfullyFunded.has(a.slot))
            .map((a) => a.slot),
        );

        // Filter: in-range must be funded, out-of-range trusted
        allConfigIds = allRelayers.filter((id) => {
          if (inRangeSlots.has(id)) {
            return fundedInRangeSet.has(id);
          }
          return true;
        });

        summary.totalConfigured = allConfigIds.length;

        if (allConfigIds.length > 0) {
          await channelsClient.setChannelAccounts(allConfigIds);
          if (!json) {
            console.log(pc.green(`done (${allConfigIds.length} relayers)`));
          }
        } else {
          if (!json) {
            console.log(pc.yellow('no relayers found'));
          }
        }
      } catch (err) {
        const errMsg = `channels config: ${err instanceof Error ? err.message : String(err)}`;
        summary.errors.push(errMsg);
        if (!json) {
          console.log(pc.red(`failed: ${err instanceof Error ? err.message : String(err)}`));
        }
      }

      // Final summary
      if (json) {
        deps.output(
          {
            summary: {
              signersCreated: summary.signersCreated,
              relayersCreated: summary.relayersCreated,
              accountsFunded: summary.accountsFunded,
              alreadyExisted: summary.alreadyExisted,
              totalConfigured: summary.totalConfigured,
              errors: summary.errors.length,
            },
            relayerIds: allConfigIds,
            errors: summary.errors.length > 0 ? summary.errors : undefined,
          },
          { json: true },
        );
      } else {
        console.log();
        console.log(pc.bold('Summary:'));
        console.log(`  Signers created: ${summary.signersCreated}`);
        console.log(`  Relayers created: ${summary.relayersCreated}`);
        console.log(`  Accounts funded: ${summary.accountsFunded}`);
        console.log(`  Already existed: ${summary.alreadyExisted}`);
        console.log(`  Channels config: ${summary.totalConfigured} relayers`);

        if (summary.errors.length > 0) {
          console.log(pc.red(`  Errors: ${summary.errors.length}`));
          for (const err of summary.errors.slice(0, 5)) {
            console.log(pc.dim(`    ${err}`));
          }
          if (summary.errors.length > 5) {
            console.log(pc.dim(`    ... and ${summary.errors.length - 5} more`));
          }
        }

        console.log();
        if (summary.errors.length === 0) {
          deps.success(`Bootstrap complete: ${summary.totalConfigured} channel accounts ready`);
        } else {
          deps.warn(`Bootstrap completed with ${summary.errors.length} error(s)`);
        }
      }
    },
  });
}

/**
 * Default bootstrap command instance for production use.
 */
export const bootstrapCommand = createBootstrapCommand();
