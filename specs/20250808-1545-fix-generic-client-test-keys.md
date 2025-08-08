# Fix Generic Client Instantiating Real Providers with Test Keys

**Task ID**: 9F88A61C-3C44-4EBF-A705-ACAB8810E904  
**Created**: 2025-08-08 15:45  
**Status**: inprogress

## Task Definition

Fix the issue where GenericLLMClientImpl instantiates real provider objects with "test-key" during tests, causing unhandled API errors. The problem is that when tests create generic clients with test API keys, real provider instances are created which may attempt to validate or use these invalid keys.

## Problem Analysis

The error occurring:

```
LLMError: OpenAI API error (401): Incorrect API key provided: test-key
```

Root cause:

- `GenericLLMClientImpl` constructor immediately instantiates provider objects
- Tests create generic clients with "test-key" for unit testing
- These real provider instances might make API calls or validations
- Results in "Unhandled error between tests" messages

## Implementation Plan

### 1. Make Provider Instantiation Lazy

- Modify GenericLLMClientImpl to delay provider creation until first use
- Store provider configuration instead of immediate instantiation
- Create provider on first method call that needs it

### 2. Update GenericLLMClientImpl Constructor

- Remove immediate provider instantiation from constructor
- Store provider type and configuration
- Add lazy initialization method

### 3. Update Provider Access Methods

- Add `getProvider()` method for lazy initialization
- Update all methods that use `this.providerImpl` to use lazy getter
- Ensure thread-safe single initialization

### 4. Verify Tests Pass

- Run generic-client.test.ts to ensure no regression
- Verify no more "test-key" API errors
- Ensure all existing functionality still works

## Acceptance Criteria

- [x] No more unhandled API errors with "test-key" in tests
- [x] All generic client tests pass
- [x] Provider is only instantiated when actually needed
- [x] No performance regression for normal usage
- [x] Backward compatibility maintained

## Update Log

**2025-08-08 15:45** - Task created, identified issue with immediate provider instantiation in constructor  
**2025-08-08 15:46** - Starting implementation of lazy provider initialization  
**2025-08-08 15:47** - Implemented lazy provider initialization in GenericLLMClientImpl  
**2025-08-08 15:48** - Updated all methods to use getProvider() for lazy initialization  
**2025-08-08 15:49** - Verified all tests pass without API errors  
**2025-08-08 15:50** - **TASK COMPLETED** - No more "test-key" API errors, lazy initialization working correctly
