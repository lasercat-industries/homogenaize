# Add Detailed Schema Parsing Failure Logging

**Task ID**: 24A7AAC7-9FAE-409C-A436-D5C2396B646F  
**Created**: 2025-01-10 17:45  
**Status**: done

## Task Definition

Enhance logging throughout the codebase to provide detailed information when schema parsing failures occur. This includes logging original payloads sent to providers, raw responses received, and exact Zod validation errors with full context.

## Implementation Plan

1. **Add Request Payload Logging**
   - Log full request body sent to each provider
   - Include headers (with API keys redacted)
   - Log at debug/verbose level for normal requests
   - Log at error level when failures occur

2. **Add Response Logging**
   - Log raw response body from providers
   - Include status codes and headers
   - Log at debug/verbose level for successful responses
   - Log at error level for failures

3. **Enhance Zod Error Logging**
   - Log full Zod error with all issues
   - Include the actual data that failed validation
   - Include the expected schema structure
   - Show exact path to the failing field

4. **Provider-Specific Implementation**
   - OpenAI: Log tool call arguments, structured output responses
   - Anthropic: Log content blocks, tool use details
   - Gemini: Log function calls, safety ratings

## Acceptance Criteria

- [ ] Original request payloads are logged for all providers
- [ ] Raw responses are logged before parsing
- [ ] Zod validation errors include full context
- [ ] Failed data is logged alongside errors
- [ ] API keys are redacted in logs
- [ ] Log levels are appropriate (debug for success, error for failures)

## Update Log

**2025-01-10 17:45** - Task created, starting implementation
**2025-01-10 18:00** - Task completed. Enhanced logging across all providers:

### Implemented Features

1. **Request Payload Logging**
   - Full request bodies logged at verbose level
   - API keys redacted for security
   - Model, messages, tools, and configurations logged

2. **Response Logging**
   - Raw responses logged before parsing
   - Successful responses at verbose level
   - Failed responses at error level with full context

3. **Enhanced Zod Error Logging**
   - Complete Zod error objects with all issues
   - Failed data included in logs
   - Schema type information
   - Formatted error output for readability

4. **Provider Coverage**
   - OpenAI: Complete request/response and Zod error logging
   - Anthropic: Complete request/response and Zod error logging
   - Gemini: Complete request/response and Zod error logging

All logging follows appropriate levels (verbose for normal operations, error for failures) and includes comprehensive context for debugging schema validation issues.
