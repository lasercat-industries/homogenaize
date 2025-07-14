# Fix Zod v4 Schema Conversion Error

## Task Definition
Fix the error "Cannot read properties of undefined (reading '_def')" when using structured output with Zod schemas in the homogenaize library. The error occurs because the library was not properly handling Zod v4's different internal structure.

## Implementation Plan
1. Identify the difference between Zod v3 and v4 schema structures
2. Update zodToOpenAISchema function to handle both versions
3. Create test case with the exact failing schema
4. Update similar functions in other providers for consistency
5. Verify fix with tests and build

## Update Log
- 2025-01-14 15:20: Task created, identified issue with Zod v4 having different _def structure
- 2025-01-14 15:25: Created test case with user's exact schema that was failing
- 2025-01-14 15:30: Updated zodToOpenAISchema to handle both Zod v3 and v4 structures
- 2025-01-14 15:35: Fixed array and optional type handling for v4 compatibility
- 2025-01-14 15:40: Updated zodToAnthropicSchema for consistency
- 2025-01-14 15:45: All tests passing, build successful, task completed