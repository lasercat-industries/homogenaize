/**
 * Configuration options for retry behavior
 */
export interface RetryConfig {
    /**
     * Maximum number of retry attempts
     * @default 3
     */
    maxRetries?: number;
    /**
     * Initial delay in milliseconds before first retry
     * @default 1000
     */
    initialDelay?: number;
    /**
     * Maximum delay in milliseconds between retries
     * @default 60000
     */
    maxDelay?: number;
    /**
     * Multiplier for exponential backoff
     * @default 2
     */
    backoffMultiplier?: number;
    /**
     * Whether to add jitter to retry delays
     * @default true
     */
    jitter?: boolean;
    /**
     * Custom function to determine if an error is retryable
     */
    retryableErrors?: (error: Error) => boolean;
    /**
     * Callback fired before each retry attempt
     */
    onRetry?: (attempt: number, error: Error, delay: number) => void;
}
/**
 * Default retry configuration
 */
export declare const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'retryableErrors' | 'onRetry'>>;
//# sourceMappingURL=types.d.ts.map