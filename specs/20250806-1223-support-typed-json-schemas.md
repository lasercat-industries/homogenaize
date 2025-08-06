# Support Both Typed and Untyped JSON Schemas

## Task Definition

Refactor the JSON Schema support to allow both typed `JSONSchemaType<T>` for compile-time type safety and `GenericJSONSchema` for flexibility. This enables users to choose between strict type-safe schemas or dynamic/generic schemas based on their needs.

## Implementation Plan

1. **Update type definitions**
   - Support both `JSONSchemaType<T>` and `GenericJSONSchema` in schema field
   - Make provider types generic to flow type information through

2. **Update schema detection utilities**
   - Add type guard for `JSONSchemaType<T>`
   - Keep existing `GenericJSONSchema` detection

3. **Update validation function**
   - Support both typed and untyped schemas
   - Preserve type information when using `JSONSchemaType<T>`

4. **Update all providers**
   - Make transform methods generic
   - Handle both schema types appropriately
   - Ensure type information flows through

5. **Write comprehensive tests**
   - Test typed schema with compile-time validation
   - Test untyped schema for backwards compatibility
   - Test type inference works correctly

## Benefits

- **Type Safety**: Users can get compile-time validation that their schema matches their TypeScript type
- **Better IntelliSense**: IDE knows what properties are required/optional
- **Flexibility**: Users can still use generic schemas when needed (dynamic schemas, backwards compatibility)
- **Early Error Detection**: Schema errors caught at compile time when using typed approach

## Update Log

### 2025-08-06 12:23

- Task created to support both typed and untyped JSON schemas
- Starting implementation

### 2025-08-06 12:40

- Completed implementation:
  - Updated type definitions to make ChatRequest and provider requests generic
  - Added isTypedJSONSchema type guard for detecting AJV's JSONSchemaType
  - Updated validation function to accept both typed and generic schemas
  - Updated all three providers to handle typed schemas
  - Created comprehensive test suite with 10 passing tests
  - All existing tests still passing (182 total tests)
- Benefits achieved:
  - Compile-time type checking for typed schemas
  - Better IDE IntelliSense and autocomplete
  - Backwards compatibility with generic schemas
  - Type inference for response data
- Task marked as done
