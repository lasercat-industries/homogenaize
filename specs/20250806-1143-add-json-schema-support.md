# Add JSON Schema Support to All Providers

## Task Definition

Implement the ability to pass JSON Schema directly to all LLM providers (OpenAI, Anthropic, Gemini) as an alternative to Zod schemas. This allows users to use raw JSON Schema for structured output validation without requiring Zod.

## Implementation Plan

1. **Install AJV for JSON Schema validation**
   - Add ajv package for runtime validation
   - Configure AJV with appropriate settings

2. **Create type definitions for JSON Schema**
   - Define JSONSchema interface matching JSON Schema Draft-07
   - Ensure compatibility with provider requirements

3. **Create utility functions for schema detection**
   - Implement isZodSchema() type guard
   - Implement isJSONSchema() type guard
   - Add to utils/schema-utils.ts

4. **Update OpenAI provider**
   - Modify transformRequest to handle both Zod and JSON Schema
   - Update transformResponse to validate with AJV for JSON Schema
   - Handle discriminated union wrapping for OpenAI compatibility

5. **Update Anthropic provider**
   - Modify transformRequest to handle both Zod and JSON Schema
   - Update transformResponse to validate with AJV for JSON Schema
   - Support structured output via tool calling

6. **Update Gemini provider**
   - Modify transformRequest to handle both Zod and JSON Schema
   - Update transformResponse to validate with AJV for JSON Schema
   - Support structured output via tool calling

7. **Implement JSON Schema validation**
   - Create validateJSONSchema function using AJV
   - Add caching for compiled validators
   - Provide clear error messages

8. **Write comprehensive tests**
   - Test schema detection utilities
   - Test JSON Schema validation
   - Test provider integration for all three providers
   - Test complex schemas (nested, arrays, oneOf)

## Key Technical Decisions

- **Schema field overloading**: The same `schema` field accepts either Zod or JSON Schema, detected at runtime
- **No schema transformation**: JSON Schema is passed directly to providers without modification
- **AJV for validation**: Using AJV for robust JSON Schema validation with caching
- **Provider compatibility**: Assuming users provide valid JSON Schema for their target provider

## Update Log

### 2025-08-06 11:43

- Task created based on user request for JSON Schema support
- Implementation completed successfully:
  - Installed AJV dependency
  - Created type definitions in src/types/json-schema.ts
  - Created utility functions in src/utils/schema-utils.ts
  - Created validation module in src/validation/json-schema-validator.ts
  - Updated all three providers to support JSON Schema
  - Wrote comprehensive tests in src/providers/json-schema.test.ts
  - All tests passing (14 tests, 0 failures)
- Task marked as done
