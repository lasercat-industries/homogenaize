/**
 * Base error class for LLM-related errors
 */
export declare class LLMError extends Error {
    statusCode?: number;
    provider?: string;
    model?: string;
    originalError?: Error;
    isRetryable?: boolean;
    retryAfter?: number;
    constructor(message: string, statusCode?: number, provider?: string, model?: string);
}
/**
 * Provider-specific error with additional context
 */
export declare class ProviderError extends LLMError {
    attempt?: number;
    context?: Record<string, any>;
    constructor(message: string, provider: string, model?: string, attempt?: number);
}
/**
 * Network-related errors (always retryable)
 */
export declare class NetworkError extends Error {
    readonly isRetryable = true;
    constructor(message: string);
}
/**
 * Rate limit error with retry-after information
 */
export declare class RateLimitError extends LLMError {
    readonly isRetryable = true;
    constructor(message: string, retryAfter: number);
}
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: Error, customClassifier?: (error: Error) => boolean): boolean;
//# sourceMappingURL=errors.d.ts.map