# Investigate Network/Fetch Mocking Test Suite Failures

**Task ID**: AB761B27-3A1B-49CA-9E1B-37DEEC381BC0
**Status**: inprogress
**Created**: 2025-01-10 18:00

## Problem Statement

New tests pass when run standalone but fail with "no network found" errors when run as part of the full test suite. This is a recent regression - it did not happen before. Likely related to fetch mocking or global state management.

## Investigation Plan

1. Identify all test files that use fetch mocking
2. Examine how fetch is currently being mocked (global replacement, library usage, etc.)
3. Search for "no network found" error messages in codebase
4. Review test setup/teardown patterns across test files
5. Check for global state pollution between tests
6. Examine test execution order and isolation
7. Review recent changes to test infrastructure or mocking setup
8. Document findings and root cause
9. Provide detailed report to user

## Findings

### Root Cause: Module-Level Global State Pollution

The issue is caused by **module-level** `global.fetch` mocking that executes when test modules are loaded, not when tests run. This creates a race condition where test files pollute each other's global state.

### The Problematic Pattern

Several test files use this pattern:

```typescript
// At module level (runs immediately when file loads)
const originalFetch = global.fetch;
global.fetch = mock() as any;

describe('Tests', () => {
  afterAll(() => {
    global.fetch = originalFetch; // Too late - originalFetch is already mocked!
  });
});
```

**Files using this pattern:**

- `src/providers/gemini/gemini.test.ts` (lines 7-10)
- `src/providers/anthropic/anthropic.test.ts` (lines 7-10)
- `src/integration/openai-client.test.ts` (lines 6-9)
- `src/integration/gemini-client.test.ts` (lines 6-9)
- `src/integration/anthropic-client.test.ts` (lines 6-9)

### Why This Fails

When Bun runs the full test suite:

1. **Module A loads** → `global.fetch = mock()` executes immediately
2. **Module B loads** → `const originalFetch = global.fetch` saves **the mock** from Module A, not the real fetch
3. **Module B's afterAll** → `global.fetch = originalFetch` restores the mock, not the real fetch
4. **Tests that need real network** → Fail with "no network found" errors because fetch is still mocked
5. **Tests expecting mocks** → May fail validation because the mock from another test file returns unexpected data

### The Execution Flow

```
Test Suite Start
├─ Load gemini.test.ts
│  └─ global.fetch = mock() <-- IMMEDIATE
├─ Load anthropic.test.ts
│  └─ const originalFetch = global.fetch <-- Captures MOCKED fetch!
│  └─ global.fetch = mock() <-- Replaces with new mock
├─ Load openai.schema.test.ts
│  └─ Expects real fetch but gets mock from previous files
│  └─ Tests fail or skip
├─ Load gemini-enum.test.ts
│  └─ beforeEach: mockFetch = mock()
│  └─ global.fetch = mockFetch
│  └─ Test runs with setup mock
│  └─ Mock returns unexpected data -> Validation error
```

### Evidence

1. **Tests pass standalone** - When run individually, no other modules load to pollute global state
2. **Tests fail in full suite** - Multiple modules load and interfere with each other
3. **Integration tests check for mocks** - `openai.schema.test.ts:24` explicitly checks if fetch is mocked and skips
4. **Anthropic integration skips** - `anthropic-enum.integration.test.ts:7` checks `!!(global.fetch as any).mock`

### Specific Example: gemini-enum.test.ts

This test fails because:

1. Earlier test files set `global.fetch = mock()` at module level
2. `gemini-enum.test.ts` runs with a polluted mock
3. The mock returns data from a different test's setup
4. Validation fails with enum errors because the response doesn't match the expected schema

### The Correct Pattern

Tests that properly isolate fetch mocking:

```typescript
let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch; // Capture BEFORE any test runs
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch; // Restore after EACH test
  mock.restore();
});
```

**Files using the correct pattern:**

- `src/retry/validation-error-retry.test.ts`
- `src/client-retry-override.test.ts`
- `src/client-retry.test.ts`
- `src/providers/openai/openai.test.ts` (uses beforeAll/afterAll correctly)

## Update Log

### 2025-01-10 18:00 - Investigation started

Beginning thorough investigation of fetch mocking and test suite failures.

### 2025-01-10 18:30 - Investigation completed

**Root cause identified:** Module-level `global.fetch` mocking creates global state pollution. When test files load, they immediately replace `global.fetch`, and subsequent files capture the mocked version as their "original", creating a chain of mock pollution.

**Impact:**

- Tests that need real network calls fail with "no network found"
- Tests expecting specific mocks receive data from other tests
- Test behavior is non-deterministic based on load order
- Standalone tests pass, full suite fails

**Solution required:**

- Move all `global.fetch` mocking from module-level to test lifecycle hooks
- Use `beforeEach`/`afterEach` or `beforeAll`/`afterAll` properly
- Ensure `originalFetch` is captured inside test hooks, not at module level
- Consider using test isolation or separate test files for unit vs integration tests
