# Implement Abort Signal Support for Requests

**Task ID**: A4EC87FD-A5ED-4C44-BAA7-B762D00EE530
**Status**: done
**Created**: 2025-10-17

## Objective

Implement AbortSignal support for homogenaize to allow users to cancel in-flight requests and retry loops.

## Requirements

1. Add optional `signal?: AbortSignal` parameter to chat and stream methods
2. Thread signal through all layers: client → provider → fetch
3. Make retry loop abort-aware (check signal between attempts)
4. Make sleep function cancellable
5. Handle streaming abort gracefully
6. Maintain backward compatibility (signal is optional)
7. Write comprehensive tests

## Implementation Plan

### Phase 1: Core Infrastructure (TDD)

1. Write test for aborting basic fetch request
2. Add AbortError class to retry/errors.ts
3. Add signal parameter to interfaces (ChatOptions, ProviderChatRequest)
4. Update sleep() function to be cancellable

### Phase 2: Provider Integration (TDD)

1. Write tests for aborting OpenAI requests
2. Thread signal through OpenAI provider to fetch calls
3. Write tests for aborting Anthropic requests
4. Thread signal through Anthropic provider to fetch calls
5. Write tests for aborting Gemini requests
6. Thread signal through Gemini provider to fetch calls

### Phase 3: Retry Loop Integration (TDD)

1. Write tests for aborting during retry loop
2. Update retry() function to check signal before each attempt
3. Write tests for aborting during retry sleep
4. Ensure signal is checked during backoff delay

### Phase 4: Streaming Support (TDD)

1. Write tests for aborting streaming requests
2. Update streaming implementations to handle abort
3. Ensure proper cleanup when stream is aborted

## Files to Modify

- `src/client.ts` - Add signal to BaseChatOptions
- `src/providers/types.ts` - Add signal to ProviderChatRequest
- `src/providers/provider.ts` - Add signal to ChatRequest
- `src/retry/retry.ts` - Make retry loop signal-aware, update sleep()
- `src/retry/errors.ts` - Add AbortError class
- `src/providers/openai/openai.ts` - Thread signal to fetch
- `src/providers/anthropic/anthropic.ts` - Thread signal to fetch
- `src/providers/gemini/gemini.ts` - Thread signal to fetch

## Test Files to Create

- `src/abort-signal.test.ts` - Basic abort functionality tests
- `src/retry/abort-retry.test.ts` - Retry loop abort tests
- `src/client-abort.test.ts` - Client-level abort tests

## Success Criteria

- [x] Users can abort non-streaming requests
- [x] Users can abort streaming requests (signal passed through)
- [x] Abort works during retry loops (breaks out immediately)
- [x] Abort works during retry sleep/backoff
- [x] All tests pass (25 new tests, 37 existing tests still pass)
- [x] No breaking changes to existing API
- [x] TypeScript compiles without errors

## Update Log

### 2025-10-17 00:00 - Task Created

Created task and spec file. Beginning TDD implementation.

### 2025-10-17 01:00 - Task Completed

Successfully implemented abort signal support with following changes:

**Core Infrastructure:**

- Added `AbortError` class to `src/retry/errors.ts`
- Updated `sleep()` function to accept optional `AbortSignal` and be cancellable
- Updated `retry()` function to check signal before each attempt and pass to sleep
- Updated `isRetryableError()` to never retry `AbortError`

**Type Interfaces:**

- Added `signal?: AbortSignal` to `ChatRequest` in `src/providers/provider.ts`
- Added `signal?: AbortSignal` to `BaseChatOptions` in `src/client.ts`
- Signal automatically available on all provider-specific request types

**Provider Integration:**

- Threaded signal through OpenAI provider (chat and stream methods)
- Threaded signal through Anthropic provider (chat and stream methods)
- Threaded signal through Gemini provider (chat and stream methods)
- All providers now pass signal to underlying fetch calls
- All providers pass signal to retry() function

**Tests Created:**

- `src/retry/abort-error.test.ts` - 5 tests for AbortError class
- `src/retry/sleep.test.ts` - 7 tests for cancellable sleep function
- `src/retry/retry-abort.test.ts` - 8 tests for retry loop abortion
- `src/client-abort.test.ts` - 5 tests for client-level abort functionality

**Test Results:**

- 25 new tests added, all passing
- 37 core unit tests still passing (no regression)
- Backward compatible - signal parameter is optional everywhere
