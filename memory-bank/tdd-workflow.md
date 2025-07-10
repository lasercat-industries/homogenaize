# Test-Driven Development Workflow

This document outlines the mandatory TDD workflow for the homogenaize project.

## Core Principle
**No implementation without a test.** Every feature, bug fix, or enhancement starts with a failing test.

## TDD Cycle

### 1. Red Phase - Write a Failing Test
- Create a `.test.ts` file next to where the implementation will live
- Write a test that describes the desired behavior
- Run the test to ensure it fails (no implementation exists yet)
- The test failure confirms we're testing the right thing

### 2. Green Phase - Make the Test Pass
- Write the minimal code necessary to make the test pass
- Don't worry about perfection - just make it work
- Run the test to ensure it passes

### 3. Refactor Phase - Improve the Code
- Now that the test passes, improve the implementation
- Extract common code, improve naming, optimize performance
- Run tests after each change to ensure nothing breaks

## Practical Example

```typescript
// Step 1: Write failing test (user.test.ts)
import { describe, it, expect } from 'bun:test';
import { createUser } from './user';

describe('createUser', () => {
  it('should create a user with valid data', () => {
    const user = createUser({ name: 'John', email: 'john@example.com' });
    expect(user.id).toBeDefined();
    expect(user.name).toBe('John');
    expect(user.email).toBe('john@example.com');
  });
});

// Step 2: Write minimal implementation (user.ts)
export function createUser(data: { name: string; email: string }) {
  return {
    id: crypto.randomUUID(),
    ...data
  };
}

// Step 3: Refactor with validation (user.ts)
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email()
});

export function createUser(data: { name: string; email: string }) {
  const validated = UserSchema.parse(data);
  return {
    id: crypto.randomUUID(),
    ...validated
  };
}
```

## Task Integration

When creating tasks for new features:

1. **Spec File Structure**
   ```markdown
   ## Implementation plan
   1. Write failing tests for [feature]
   2. Implement [feature] to make tests pass
   3. Refactor and optimize implementation
   4. Update documentation
   ```

2. **Task Tracking**
   - Tasks cannot be marked "done" without tests
   - Test creation must be logged in spec update logs

## Benefits of TDD in This Project

1. **Documentation**: Tests serve as living documentation
2. **Confidence**: Refactoring is safe with comprehensive tests
3. **Design**: Writing tests first improves API design
4. **Coverage**: Ensures all features are tested from the start

## Red Flags

Watch for these TDD violations:
- Implementation files created before test files
- Tasks marked complete without tests
- "I'll add tests later" mentality
- Tests written after implementation (retrofitting)

## Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run specific test file
bun test src/user.test.ts
```

Remember: TDD is not about testing, it's about design. Tests drive better code architecture.