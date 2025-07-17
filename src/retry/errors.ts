/**
 * Base error class for LLM-related errors
 */
export class LLMError extends Error {
  public statusCode?: number;
  public provider?: string;
  public model?: string;
  public originalError?: Error;
  public isRetryable?: boolean;
  public retryAfter?: number;

  constructor(message: string, statusCode?: number, provider?: string, model?: string) {
    super(message);
    this.name = 'LLMError';
    this.statusCode = statusCode;
    this.provider = provider;
    this.model = model;

    // Automatically determine if retryable based on status code
    if (statusCode) {
      this.isRetryable = isRetryableStatusCode(statusCode);
    }
  }
}

/**
 * Provider-specific error with additional context
 */
export class ProviderError extends LLMError {
  public attempt?: number;
  public context?: Record<string, unknown>;

  constructor(message: string, provider: string, model?: string, attempt?: number) {
    super(message, undefined, provider, model);
    this.name = 'ProviderError';
    this.attempt = attempt;
  }
}

/**
 * Network-related errors (always retryable)
 */
export class NetworkError extends Error {
  public readonly isRetryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Rate limit error with retry-after information
 */
export class RateLimitError extends LLMError {
  public override readonly isRetryable = true;

  constructor(message: string, retryAfter: number) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Check if a status code indicates a retryable error
 */
function isRetryableStatusCode(statusCode: number): boolean {
  // Rate limiting
  if (statusCode === 429) return true;

  // Server errors
  if (statusCode >= 500 && statusCode < 600) return true;

  // Anthropic-specific overloaded status
  if (statusCode === 529) return true;

  return false;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(
  error: Error,
  customClassifier?: (error: Error) => boolean,
): boolean {
  // Use custom classifier if provided
  if (customClassifier) {
    return customClassifier(error);
  }

  // Check explicit isRetryable property
  if ('isRetryable' in error && typeof error.isRetryable === 'boolean') {
    return error.isRetryable;
  }

  // Check if it's an LLMError with status code
  if (error instanceof LLMError && error.statusCode) {
    return isRetryableStatusCode(error.statusCode);
  }

  // Check provider-specific error formats
  const errorAny = error as Error & {
    status?: number;
    code?: string;
    response?: { status?: number };
  };

  // OpenAI/Anthropic style
  if (errorAny.status && typeof errorAny.status === 'number') {
    return isRetryableStatusCode(errorAny.status);
  }

  // Check for network errors by message
  const message = error.message.toUpperCase();
  const networkErrors = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'SOCKET',
    'TIMEOUT',
    'NETWORK',
  ];

  if (networkErrors.some((err) => message.includes(err))) {
    return true;
  }

  // Gemini-specific error messages
  if (message.includes('RESOURCE_EXHAUSTED') || message.includes('UNAVAILABLE')) {
    return true;
  }

  // Default to non-retryable
  return false;
}
