import { Configuration, HealthApi, RelayersApi, SignersApi } from '@openzeppelin/relayer-sdk';
import type { ResolvedConfig } from '../config/index.js';

export interface ApiClient {
  health: HealthApi;
  relayers: RelayersApi;
  signers: SignersApi;
  config: ResolvedConfig;
}

export function createClient(config: ResolvedConfig): ApiClient {
  const sdkConfig = new Configuration({
    basePath: config.url.replace(/\/$/, ''),
    accessToken: config.apiKey,
  });

  return {
    health: new HealthApi(sdkConfig),
    relayers: new RelayersApi(sdkConfig),
    signers: new SignersApi(sdkConfig),
    config,
  };
}
