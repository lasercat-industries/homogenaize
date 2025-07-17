import type { RetryConfig } from './types';
/**
 * Calculate exponential backoff delay
 */
export declare function calculateBackoff(attempt: number, initialDelay: number, multiplier: number, maxDelay?: number): number;
/**
 * Add jitter to a delay value
 * Returns a value between 50% and 100% of the original delay
 */
export declare function withJitter(delay: number): number;
/**
 * Retry a function with exponential backoff
 */
export declare function retry<T>(fn: () => Promise<T>, config?: RetryConfig): Promise<T>;
/**
 * Create a retryable version of a function
 */
export declare function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(fn: T, config?: RetryConfig): T;
//# sourceMappingURL=retry.d.ts.map