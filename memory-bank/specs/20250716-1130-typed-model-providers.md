# Update Providers to Use Typed Model Names

## Task Definition

Update all provider interfaces and client configurations to use the generated model types (OpenaiModel, AnthropicModel, GeminiModel) instead of plain strings. This will provide compile-time validation of model names.

## Implementation Plan

1. **Update provider type definitions**
   - Modify ProviderConfigs to use typed models
   - Update LLMConfig to use typed models
   - Ensure backward compatibility with string literals

2. **Update client implementations**
   - Update createLLM to validate model types
   - Update provider-specific create functions
   - Add runtime validation using model constants

3. **Update tests**
   - Ensure all tests use valid model names
   - Add tests for invalid model rejection
   - Test autocomplete functionality

4. **Update documentation**
   - Show benefits of typed models
   - Document migration path for users

## Technical Details

Key changes:

- `model: string` → `model: OpenaiModel | AnthropicModel | GeminiModel`
- Add type guards for model validation
- Maintain compatibility with string literals that match valid models

## Update Log

- 2025-07-16 11:30 - Task created, beginning implementation
- 2025-07-16 11:35 - Updated provider types:
  - Added ProviderModels type mapping providers to their model types
  - Updated LLMConfig to use ProviderModels[P] for model field
  - Updated LLMClient interface to use typed models
  - Updated LLMClientImpl constructor to use typed models
- 2025-07-16 11:40 - Fixed all test files to use valid model names
- 2025-07-16 11:42 - Created typed-models.test.ts to verify type safety
- 2025-07-16 11:44 - Updated README with typed model documentation
- 2025-07-16 11:45 - All tests passing, TypeScript compilation successful
