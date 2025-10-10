# Fix Module-Level Fetch Mocking in Test Files

**Task ID**: C49A2AA2-74EE-4853-8AEF-37AB095701B6
**Status**: inprogress
**Created**: 2025-01-10 18:30
**Depends on**: AB761B27-3A1B-49CA-9E1B-37DEEC381BC0

## Task Definition

Fix global fetch mocking in 5 test files by moving module-level mocking into test lifecycle hooks (beforeAll/afterAll). This will prevent global state pollution and test cross-contamination.

## Implementation Plan

### Files to Fix (Priority Order)

1. `src/providers/gemini/gemini.test.ts` - Move lines 7-10 into beforeAll
2. `src/providers/anthropic/anthropic.test.ts` - Move lines 7-10 into beforeAll
3. `src/integration/openai-client.test.ts` - Move lines 6-9 into beforeAll
4. `src/integration/gemini-client.test.ts` - Move lines 6-9 into beforeAll
5. `src/integration/anthropic-client.test.ts` - Move lines 6-9 into beforeAll

### Pattern to Apply

**Change from:**

```typescript
const originalFetch = global.fetch;
global.fetch = mock() as any;

describe('Tests', () => {
  beforeEach(() => {
    (global.fetch as any).mockClear();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });
});
```

**Change to:**

```typescript
describe('Tests', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
    global.fetch = mock() as any;
  });

  beforeEach(() => {
    (global.fetch as any).mockClear();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });
});
```

### Verification Steps

1. Run each fixed test file individually to ensure it still passes
2. Run full test suite to verify no cross-contamination
3. Run full suite multiple times to check for flakiness

## Update Log

### 2025-01-10 18:30 - Task created and starting implementation

Applying fixes to all 5 affected test files.
