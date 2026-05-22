import { error } from './output.js';

// Global verbose flag - set by commands that support it
let verboseMode = false;

export function setVerbose(verbose: boolean): void {
  verboseMode = verbose;
}

export function isVerbose(): boolean {
  return verboseMode;
}

// Duck-type check for axios errors (instanceof fails after bundling)
interface AxiosLikeError {
  response?: {
    status?: number;
    data?: unknown;
    headers?: Record<string, string>;
  };
  config?: {
    url?: string;
    baseURL?: string;
    method?: string;
  };
  message?: string;
  stack?: string;
  isAxiosError?: boolean;
}

function isAxiosLikeError(err: unknown): err is AxiosLikeError {
  return (
    err !== null &&
    typeof err === 'object' &&
    ('response' in err || 'config' in err || 'isAxiosError' in err)
  );
}

export const ExitCodes = {
  Success: 0,
  GeneralError: 1,
  InvalidUsage: 2,
  AuthenticationFailure: 3,
  ResourceNotFound: 4,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

export interface ApiErrorDetails {
  [key: string]: unknown;
  status?: number;
  code?: string;
  message?: string;
  requestId?: string;
  // Verbose details
  url?: string;
  method?: string;
  responseBody?: unknown;
  stack?: string;
}

export function extractErrorDetails(err: unknown): ApiErrorDetails {
  if (isAxiosLikeError(err)) {
    const response = err.response;
    const config = err.config;
    // Build full URL from baseURL + url
    const baseUrl = config?.baseURL || '';
    const path = config?.url || '';
    const fullUrl = baseUrl ? `${baseUrl}${path}` : path;

    const data = response?.data as Record<string, unknown> | undefined;

    return {
      status: response?.status,
      code:
        (data?.code as string | undefined) ||
        ((data?.error as Record<string, unknown>)?.code as string | undefined),
      message:
        (data?.message as string | undefined) ||
        ((data?.error as Record<string, unknown>)?.message as string | undefined) ||
        err.message,
      requestId: response?.headers?.['x-request-id'],
      // Verbose details
      url: fullUrl || undefined,
      method: config?.method?.toUpperCase(),
      responseBody: response?.data,
      stack: err.stack,
    };
  }
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

export function handleApiError(err: unknown): never {
  const details = extractErrorDetails(err);

  let exitCode: ExitCode = ExitCodes.GeneralError;
  let message = details.message || 'An unexpected error occurred';

  if (details.status === 401 || details.status === 403) {
    exitCode = ExitCodes.AuthenticationFailure;
    message = 'Authentication failed';
  } else if (details.status === 404) {
    exitCode = ExitCodes.ResourceNotFound;
    message = 'Resource not found';
  }

  error(message, details, verboseMode);
  process.exit(exitCode);
}

export function exitWithUsageError(message: string): never {
  error(message);
  process.exit(ExitCodes.InvalidUsage);
}

export function exitWithSuccess(): never {
  process.exit(ExitCodes.Success);
}
