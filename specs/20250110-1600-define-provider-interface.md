# Task: Define provider interface

## Task definition
Create the core provider interface that all LLM providers (OpenAI, Anthropic, Gemini) will implement. This forms the foundation of the library's abstraction layer.

## Implementation plan
1. Write tests for provider interface behavior
2. Define base types (Message, ChatRequest, ChatResponse, etc.)
3. Create the Provider interface with required methods
4. Define provider-specific feature types
5. Implement type-safe factory functions
6. Add provider capability detection

## Update log
- 2025-01-10 16:00: Task created. Starting with TDD approach for provider interface design.