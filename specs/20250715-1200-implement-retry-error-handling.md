# Implement Retry Support and Error Handling

## Task Definition

Add comprehensive retry logic and error handling to the homogenaize library to make it more resilient to transient failures, rate limits, and network issues. This includes implementing exponential backoff, error classification, and configurable retry strategies across all providers.

## Implementation Plan

### 1. Write Tests First (TDD)

- [x] Create tests for retry utility functions (exponential backoff, jitter)
- [x] Create tests for error classification (retryable vs non-retryable)
- [x] Create tests for retry wrapper functionality
- [ ] Create integration tests for retry behavior with mocked API responses

### 2. Implement Core Retry Infrastructure

- [x] Create `src/retry/types.ts` with retry configuration interfaces
- [x] Create `src/retry/errors.ts` with error classification logic
- [x] Create `src/retry/retry.ts` with exponential backoff and main retry wrapper function
- [x] Create `src/retry/index.ts` to export all retry functionality

### 3. Integrate Retry Logic into Providers

- [x] Update base client to accept retry configuration
- [x] Wrap OpenAI provider methods with retry logic
- [x] Wrap Anthropic provider methods with retry logic
- [x] Wrap Gemini provider methods with retry logic
- [ ] Handle streaming retries (more complex due to partial data)

### 4. Provider-Specific Error Handling

- [x] Parse and classify OpenAI errors (rate limits, server errors)
- [x] Parse and classify Anthropic errors
- [x] Parse and classify Gemini errors
- [x] Respect Retry-After headers when present

### 5. Enhanced Error Objects

- [x] Create rich error types with context (attempt number, provider, model)
- [x] Implement error chaining to preserve original errors
- [x] Add telemetry hooks for monitoring retry attempts

### 6. Testing and Documentation

- [x] Run all existing tests to ensure no regressions
- [ ] Add retry examples to documentation
- [ ] Test with real API rate limits (careful not to abuse APIs)

## Technical Details

### Retry Configuration Interface

```typescript
interface RetryConfig {
  maxRetries?: number; // Default: 3
  initialDelay?: number; // Default: 1000ms
  maxDelay?: number; // Default: 60000ms
  backoffMultiplier?: number; // Default: 2
  jitter?: boolean; // Default: true
  retryableErrors?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}
```

### Error Classification

- Retryable: 429, 500, 502, 503, network timeouts
- Non-retryable: 400, 401, 403, 404, validation errors

### Exponential Backoff Formula

```
delay = min(initialDelay * (backoffMultiplier ^ attempt), maxDelay)
if jitter: delay = delay * (0.5 + Math.random() * 0.5)
```

## Update Log

### 2025-01-15 12:00

- Created task and spec file
- Defined comprehensive implementation plan following TDD approach
- Outlined retry configuration interface and technical details

### 2025-01-15 12:30

- Implemented core retry infrastructure following TDD
- Created comprehensive test suite for retry functionality (32 tests, all passing)
- Implemented error types: LLMError, ProviderError, NetworkError, RateLimitError
- Built retry logic with exponential backoff, jitter, and Retry-After header support
- All tests passing, ready to integrate into providers

### 2025-01-15 13:00

- Integrated retry configuration into client initialization
- Added retry support to all three providers (OpenAI, Anthropic, Gemini)
- Updated providers to throw LLMError with proper status codes and retry-after support
- Fixed all provider tests to include headers in mock responses
- Created comprehensive client retry tests (6 tests, all passing)
- Retry functionality now working across all providers with configurable behavior
