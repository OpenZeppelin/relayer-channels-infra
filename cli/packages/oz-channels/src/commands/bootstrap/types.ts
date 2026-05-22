import type { NetworkName } from '../../utils/stellar.js';

export interface AccountAudit {
  /** Slot name (e.g., "channel-0001") */
  slot: string;
  /** Signer ID (e.g., "channel-0001-signer") */
  signerId: string;
  /** Whether the signer exists in the relayer service */
  signerExists: boolean;
  /** Whether the relayer exists in the relayer service */
  relayerExists: boolean;
  /** Whether the account is funded on-chain */
  onChainFunded: boolean;
  /** Relayer's Stellar address if it exists */
  relayerAddress?: string;
  /** Current XLM balance if funded */
  balance?: string;
  /** Error message if audit failed */
  error?: string;
}

export interface PreflightResult {
  /** All audited accounts */
  accounts: AccountAudit[];
  /** Counts of existing resources */
  existing: {
    signers: number;
    relayers: number;
    funded: number;
  };
  /** Counts of missing resources */
  missing: {
    signers: number;
    relayers: number;
    unfunded: number;
  };
  /** Highest existing slot number (for gap detection) */
  highestExisting: number;
  /** Whether a gap was detected in the slot sequence */
  gapDetected: boolean;
  /** Gap range [start, end] if detected */
  gapRange?: [number, number];
  /** Existing channel config IDs from plugin */
  existingConfigIds: string[];
}

export interface BootstrapOptions {
  /** Starting slot number (inclusive) */
  from: number;
  /** Ending slot number (inclusive) */
  to: number;
  /** Relayer ID for funding new accounts */
  fundingRelayer: string;
  /** XLM amount for each new account */
  startingBalance: number;
  /** Slot name prefix */
  prefix: string;
  /** Zero-padding for slot numbers */
  padding: number;
  /** Maximum concurrent preflight operations */
  concurrency: number;
  /** Delay between sequential operations in ms */
  delayMs: number;
  /** Audit-only mode (no changes) */
  audit: boolean;
  /** Dry-run mode (show plan, no changes) */
  dryRun: boolean;
  /** Verbose output */
  verbose: boolean;
  /** JSON output mode */
  json: boolean;
  /** Allow gaps in slot sequence */
  allowGaps: boolean;
  /** Stellar network */
  network: NetworkName;
  /** Disable interactive prompts */
  noInput: boolean;
}

export interface CreateResult {
  slot: string;
  signerId: string;
  signerCreated: boolean;
  relayerCreated: boolean;
  relayerAddress?: string;
  error?: string;
}

export interface FundResult {
  slot: string;
  address: string;
  funded: boolean;
  alreadyFunded?: boolean;
  error?: string;
}

export interface BootstrapSummary {
  signersCreated: number;
  relayersCreated: number;
  accountsFunded: number;
  alreadyExisted: number;
  totalConfigured: number;
  errors: string[];
}
