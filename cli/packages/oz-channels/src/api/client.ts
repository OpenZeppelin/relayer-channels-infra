import {
  ChannelsClient,
  type ChannelsClientConfig,
  type ChannelsFuncAuthRequest,
  type ChannelsTransactionResponse,
  type ChannelsXdrRequest,
  type DeleteFeeLimitResponse,
  type GetFeeLimitResponse,
  type GetFeeUsageResponse,
  type ListChannelAccountsResponse,
  type SetChannelAccountsResponse,
  type SetFeeLimitResponse,
} from '@openzeppelin/relayer-plugin-channels';
import type { ResolvedConfig } from '../config/index.js';

export interface ApiClient {
  channels: ChannelsClient;
  config: ResolvedConfig;

  // Transaction submission
  submitXdr(request: ChannelsXdrRequest): Promise<ChannelsTransactionResponse>;
  submitFuncAuth(request: ChannelsFuncAuthRequest): Promise<ChannelsTransactionResponse>;

  // Channel account management (requires adminSecret)
  listChannelAccounts(): Promise<ListChannelAccountsResponse>;
  setChannelAccounts(relayerIds: string[]): Promise<SetChannelAccountsResponse>;

  // Fee management (requires adminSecret)
  getFeeUsage(apiKey: string): Promise<GetFeeUsageResponse>;
  getFeeLimit(apiKey: string): Promise<GetFeeLimitResponse>;
  setFeeLimit(apiKey: string, limit: number): Promise<SetFeeLimitResponse>;
  deleteFeeLimit(apiKey: string): Promise<DeleteFeeLimitResponse>;

  // Health check
  healthCheck(): Promise<{ healthy: boolean }>;
}

export function createClient(config: ResolvedConfig): ApiClient {
  const sdkConfig: ChannelsClientConfig = config.pluginId
    ? {
        // Relayer mode
        baseUrl: config.url.replace(/\/$/, ''),
        pluginId: config.pluginId,
        apiKey: config.apiKey,
        adminSecret: config.adminSecret,
      }
    : {
        // Direct HTTP mode
        baseUrl: config.url.replace(/\/$/, ''),
        apiKey: config.apiKey,
        adminSecret: config.adminSecret,
      };

  const channels = new ChannelsClient(sdkConfig);

  return {
    channels,
    config,

    async submitXdr(request: ChannelsXdrRequest) {
      return channels.submitTransaction(request);
    },

    async submitFuncAuth(request: ChannelsFuncAuthRequest) {
      return channels.submitSorobanTransaction(request);
    },

    async listChannelAccounts() {
      return channels.listChannelAccounts();
    },

    async setChannelAccounts(relayerIds: string[]) {
      return channels.setChannelAccounts(relayerIds);
    },

    async getFeeUsage(apiKey: string) {
      return channels.getFeeUsage(apiKey);
    },

    async getFeeLimit(apiKey: string) {
      return channels.getFeeLimit(apiKey);
    },

    async setFeeLimit(apiKey: string, limit: number) {
      return channels.setFeeLimit(apiKey, limit);
    },

    async deleteFeeLimit(apiKey: string) {
      return channels.deleteFeeLimit(apiKey);
    },

    async healthCheck() {
      // Try a simple operation to verify connectivity
      // For channels service, we'll try to list channel accounts if we have admin,
      // otherwise we'll just verify the URL is reachable
      const url = config.pluginId
        ? `${config.url.replace(/\/$/, '')}/api/v1/health`
        : `${config.url.replace(/\/$/, '')}/health`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      return { healthy: response.ok };
    },
  };
}
