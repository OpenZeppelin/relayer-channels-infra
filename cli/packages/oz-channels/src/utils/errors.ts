import { AxiosError } from 'axios';
import { error } from './output.js';

export const ExitCodes = {
  Success: 0,
  GeneralError: 1,
  InvalidUsage: 2,
  AuthenticationFailure: 3,
  ResourceNotFound: 4,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

export interface ApiErrorDetails {
  status?: number;
  code?: string;
  message?: string;
  requestId?: string;
}

export function extractErrorDetails(err: unknown): ApiErrorDetails {
  if (err instanceof AxiosError) {
    const response = err.response;
    return {
      status: response?.status,
      code: response?.data?.code || response?.data?.error?.code,
      message: response?.data?.message || response?.data?.error?.message || err.message,
      requestId: response?.headers?.['x-request-id'],
    };
  }
  if (err instanceof Error) {
    return { message: err.message };
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
  } else if (details.status === 409) {
    message = details.message || 'Conflict: resource is locked or in use';
  } else if (details.status === 429) {
    message = details.message || 'Fee limit exceeded';
  }

  error(message, details as Record<string, unknown>);
  process.exit(exitCode);
}

export function exitWithUsageError(message: string): never {
  error(message);
  process.exit(ExitCodes.InvalidUsage);
}

export function exitWithSuccess(): never {
  process.exit(ExitCodes.Success);
}
