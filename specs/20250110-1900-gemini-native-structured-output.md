# Implement Native Structured Output for Gemini

**Task ID**: 2C56D48D-31EB-4DDB-A232-16ECEB38EFE7  
**Created**: 2025-01-10 19:00  
**Status**: inprogress

## Task Definition

Implement native structured output support for Gemini using the `responseSchema` and `responseMimeType` fields when only a schema is provided (no tools). Keep the current tool-based approach when both schema and tools are provided.

## Implementation Plan

1. **Create Gemini-specific schema converter**
   - Convert Zod schemas to Gemini's native format (uppercase types)
   - Handle OBJECT, ARRAY, STRING, INTEGER, NUMBER, BOOLEAN types
   - Add propertyOrdering for consistent output

2. **Update transformRequest in Gemini provider**
   - Check if only schema is provided (no tools)
   - If yes, use generationConfig.responseSchema
   - If both schema and tools, use current tool approach

3. **Update transformResponse in Gemini provider**
   - Handle direct JSON response when using native structured output
   - Parse and validate against the original schema

4. **Test the implementation**
   - Test with schema only
   - Test with tools only
   - Test with both schema and tools
   - Ensure backward compatibility

## Acceptance Criteria

- [ ] Native structured output works when only schema is provided
- [ ] Tool-based approach still works when both schema and tools are provided
- [ ] All existing tests pass
- [ ] Gemini schema format is correct (uppercase types)
- [ ] Property ordering is maintained

## Update Log

**2025-01-10 19:00** - Task created, starting implementation

**2025-01-13** - Task completed successfully

- Implemented `zodToGeminiNativeSchema` function to convert Zod schemas to Gemini's native format
- Added GeminiNativeSchema interface with uppercase type names (STRING, INTEGER, etc.)
- Updated GeminiRequest interface to include responseSchema field in generationConfig
- Modified transformRequest to use native responseSchema when only schema is provided
- Modified transformResponse to handle native structured output responses
- Updated all affected tests to expect native structured output instead of tool-based approach
- All tests passing successfully
