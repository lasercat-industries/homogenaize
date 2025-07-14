# Refactor Structured Output to Use Forced Tool Calling

## Task Definition

Refactor the structured output implementation to use forced tool calling internally instead of provider-specific methods. This provides stronger guarantees that the output matches the schema, as tool calling is more reliable than prompt engineering.

## Implementation Plan

1. Write tests for the new behavior
2. Update OpenAI provider to use tool calling for structured output
3. Update Anthropic provider to use tool calling for structured output
4. Update Gemini provider to use tool calling for structured output
5. Ensure backward compatibility - API should remain unchanged
6. Run all tests to verify nothing breaks

## Technical Approach

When a user provides a `schema` parameter:

1. Create a hidden tool with the schema
2. Force the LLM to call this tool using `toolChoice: 'required'`
3. Extract the structured data from the tool call response
4. Return it as a normal chat response, hiding the tool call details

## Update Log

- 2025-01-14 15:45: Task created, planning implementation approach
- 2025-01-14 16:00: Wrote tests for new behavior
- 2025-01-14 16:15: Updated OpenAI provider to use tool calling for structured output
- 2025-01-14 16:30: Updated Anthropic provider to use tool calling for structured output
- 2025-01-14 16:45: Updated Gemini provider to use tool calling for structured output
- 2025-01-14 17:00: Fixed Zod v4 compatibility issues in all providers
- 2025-01-14 17:15: Updated all integration and unit tests to expect tool calling behavior
- 2025-01-14 17:30: All tests passing except 2 unrelated timeout issues
