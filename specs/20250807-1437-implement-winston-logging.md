# Implement Winston Logging System

## Task Definition

Implement a comprehensive logging system using Winston to provide configurable, structured logging throughout the Homogenaize library. The system should be silent by default, support multiple log levels, and provide clear visibility into library operations when enabled.

## Implementation Plan

### Phase 1: Setup and Configuration

1. Install Winston and required dependencies
   - winston package
   - @types/winston for TypeScript support
2. Create logger configuration module (`src/utils/logger.ts`)
   - Define LoggerConfig interface
   - Implement singleton logger factory
   - Support environment variable configuration
   - Implement log level hierarchy (error, warn, info, debug, verbose)
   - Add contextual metadata support

### Phase 2: Replace Existing Console Logs

1. Identify and replace console.log statements in OpenAI provider
   - Schema transformation logs → debug level
   - Request/response logs → verbose level
   - Error logs → error level

### Phase 3: Systematic Logging Implementation

1. Add logging to all providers (OpenAI, Anthropic, Gemini)
   - Request initiation (info)
   - Schema transformation (debug)
   - Tool calling setup (debug)
   - Response parsing (debug)
   - Full payloads (verbose)
   - Errors and retries (error/warn)

2. Add logging to client layer (`src/client.ts`)
   - Provider selection (info)
   - Model validation (debug)
   - Request routing (debug)
   - Configuration issues (error)

3. Add logging to retry logic (`src/retry/index.ts`)
   - Retry attempts (info)
   - Backoff calculations (debug)
   - Max retries warning (warn)
   - Final failure (error)

4. Add logging to schema validation
   - Schema type detection (debug)
   - Conversion process (debug)
   - Validation failures (error)

### Phase 4: Configuration Integration

1. Update client configuration interfaces
   - Add logging property to ClientConfig
   - Support boolean (on/off) and object configuration
   - Add to createLLM, createOpenAILLM, createAnthropicLLM, createGeminiLLM

2. Implement configuration precedence
   - Explicit configuration > Environment variables > Default (silent)

### Phase 5: Testing

1. Write unit tests for logger module
   - Configuration parsing
   - Log level filtering
   - Format selection
   - Environment variable handling

2. Write integration tests
   - Verify logging in providers
   - Test configuration propagation
   - Ensure no logs by default

### Phase 6: Documentation

1. Update README.md
   - Add logging configuration section
   - Provide usage examples
   - Document environment variables

2. Add inline documentation
   - JSDoc comments for logger module
   - Configuration examples in code

## Success Criteria

- [ ] Winston installed and configured
- [ ] All console.log statements replaced with appropriate log levels
- [ ] Logging added systematically across all components
- [ ] Configuration options available in all client creation methods
- [ ] Environment variable support implemented
- [ ] No logs output by default
- [ ] Comprehensive test coverage
- [ ] Documentation updated

## Technical Considerations

- Ensure API keys and sensitive data are never logged
- Add request IDs for tracing async operations
- Minimize performance impact when logging is disabled
- Use structured logging (JSON) for production compatibility
- Support custom transports for advanced use cases

## Update Log

- 2025-08-07 14:37: Task created, spec defined
- 2025-08-07 15:00: Completed Phase 1-3: Winston installed, logger module created with tests, logging added to all providers (OpenAI, Anthropic, Gemini)
- 2025-08-07 15:10: Completed Phase 4 (partial): Added logging configuration to client.ts and createLLM factory function
- 2025-08-07 15:45: Completed all phases: Fixed TypeScript and ESLint issues, comprehensive README documentation added with examples
