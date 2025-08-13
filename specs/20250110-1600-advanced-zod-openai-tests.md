# Create Advanced Zod Schema Tests for OpenAI

**Task ID**: BCAEF31C-D9A8-46A3-AF6F-314C91CD81AD  
**Created**: 2025-01-10 16:00  
**Status**: inprogress

## Task Definition

Create a comprehensive test suite for advanced Zod schemas with OpenAI to understand the current state of support for complex schema types. This will help identify what works and what doesn't with OpenAI's structured output capabilities.

## Implementation Plan

1. Create test file for advanced Zod schemas
2. Test discriminated unions
3. Test recursive schemas
4. Test complex nested objects
5. Test Zod refinements and transforms
6. Test optional/nullable fields
7. Test arrays with constraints
8. Test record types
9. Test tuple types
10. Test literal types and enums
11. Test intersection and union types
12. Test custom error messages
13. Run tests and document results

## Test Categories

- Discriminated unions (multiple variants)
- Recursive schemas (tree structures)
- Deep nesting (3+ levels)
- Complex refinements (custom validations)
- Transforms (data manipulation)
- Mixed type unions
- Conditional schemas
- Large schemas (many fields)
- Regex patterns
- Date/time validations

## Acceptance Criteria

- [x] Test file created with comprehensive schema examples
- [x] Tests cover all major Zod features
- [x] Results documented (pass/fail for each schema type)
- [x] No attempt to fix failing tests (just document state)

## Test Results Summary

### ✅ WORKING (OpenAI supports these)

- Discriminated unions (basic and nested)
- Complex deeply nested objects (4+ levels)
- Custom refinements and validations
- Transforms (string manipulation, type coercion)
- Arrays with min/max constraints
- Intersection types
- Optional and nullable fields
- Date/time string validations
- Regex patterns
- Large schemas (20+ fields)
- Branded types
- Preprocessing and coercion
- Default values
- Custom error messages

### ❌ FAILING (OpenAI doesn't support these)

- Recursive schemas (tree structures, comment threads) - Error: "schema must be a JSON Schema of 'type: "object"', got 'type: "string"'"
- Sets (z.set) - Returns undefined
- Maps (z.map) - Returns undefined
- Record types with complex constraints - Returns undefined
- Tuples - Returns undefined
- Non-discriminated unions - Returns undefined
- Catch/CatchAll schemas - May have issues
- Pipeline compositions - May have issues

## Update Log

**2025-01-10 16:00** - Task created, starting implementation  
**2025-01-10 16:05** - Created comprehensive test file with 20+ test categories  
**2025-01-10 16:10** - Ran tests and documented results  
**2025-01-10 16:15** - **TASK COMPLETED** - State of OpenAI Zod support documented
