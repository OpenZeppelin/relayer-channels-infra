import { execSync } from 'node:child_process';

export interface StellarAccount {
  publicKey: string;
  secretKey: string;
}

export type NetworkName = 'testnet' | 'mainnet' | 'futurenet';

export interface NetworkConfig {
  horizonUrl: string;
  passphrase: string;
  friendbotUrl?: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: 'Test SDF Network ; September 2015',
    friendbotUrl: 'https://friendbot.stellar.org',
  },
  mainnet: {
    horizonUrl: 'https://horizon.stellar.org',
    passphrase: 'Public Global Stellar Network ; September 2015',
  },
  futurenet: {
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    passphrase: 'Test SDF Future Network ; October 2022',
    friendbotUrl: 'https://friendbot-futurenet.stellar.org',
  },
};

export function getStellarAccount(name: string): StellarAccount | null {
  try {
    const publicKey = execSync(`stellar keys address ${name}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const secretKey = execSync(`stellar keys show ${name}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return { publicKey, secretKey };
  } catch {
    return null;
  }
}

export function stellarAccountExists(name: string): boolean {
  return getStellarAccount(name) !== null;
}

export function generateStellarAccount(name: string, network: string): void {
  execSync(`stellar keys generate ${name} --network ${network}`, {
    stdio: 'inherit',
  });
}

export function deployContract(wasmPath: string, accountName: string, network: string): string {
  const output = execSync(
    `stellar contract deploy --wasm ${wasmPath} --source ${accountName} --network ${network}`,
    { encoding: 'utf-8' },
  );
  return output.trim();
}

export function buildSorobanInvoke(
  contractId: string,
  method: string,
  args: string[],
  accountName: string,
  network: string,
): string {
  const argsStr = args.length > 0 ? args.join(' ') : '';
  const cmd = `stellar contract invoke --id ${contractId} --network ${network} --source ${accountName} -- ${method}${argsStr ? ` ${argsStr}` : ''} --build-only`;

  const output = execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Extract base64 XDR from output (typically the last non-empty line that looks like base64)
  const lines = output.trim().split('\n');
  const xdrLine = lines.find((l) => /^[A-Za-z0-9+/=]+$/.test(l.trim()));
  return xdrLine?.trim() || '';
}

export async function fundViaFriendbot(
  publicKey: string,
  network: NetworkName = 'testnet',
): Promise<boolean> {
  const networkConfig = NETWORKS[network];
  if (!networkConfig.friendbotUrl) {
    return false;
  }
  try {
    const response = await fetch(`${networkConfig.friendbotUrl}?addr=${publicKey}`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function checkAccountFunded(
  publicKey: string,
  network: NetworkName,
): Promise<{ funded: boolean; balance?: string }> {
  const networkConfig = NETWORKS[network];

  try {
    const response = await fetch(`${networkConfig.horizonUrl}/accounts/${publicKey}`);
    if (!response.ok) {
      return { funded: false };
    }
    const data = (await response.json()) as {
      balances: Array<{ asset_type: string; balance: string }>;
    };
    const nativeBalance = data.balances.find((b) => b.asset_type === 'native');
    return {
      funded: true,
      balance: nativeBalance?.balance,
    };
  } catch {
    return { funded: false };
  }
}

export interface FeeStats {
  lastLedgerBaseFee: number;
  ledgerCapacityUsage: number;
  feeCharged: {
    min: number;
    max: number;
    mode: number;
    p10: number;
    p20: number;
    p30: number;
    p40: number;
    p50: number;
    p60: number;
    p70: number;
    p80: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

/**
 * Fetch competitive fee from Horizon fee_stats endpoint.
 * Returns max(100000, p80 * 2) to ensure competitive fee during congestion.
 */
export async function fetchCompetitiveFee(network: NetworkName): Promise<number> {
  const networkConfig = NETWORKS[network];
  const MIN_FEE = 100000; // 0.01 XLM - reasonable minimum

  try {
    const response = await fetch(`${networkConfig.horizonUrl}/fee_stats`);
    if (!response.ok) {
      return MIN_FEE;
    }

    const data = (await response.json()) as {
      fee_charged: {
        p80: string;
      };
    };

    const p80 = Number(data.fee_charged.p80);
    if (Number.isNaN(p80)) {
      return MIN_FEE;
    }

    return Math.max(MIN_FEE, p80 * 2);
  } catch {
    return MIN_FEE;
  }
}
