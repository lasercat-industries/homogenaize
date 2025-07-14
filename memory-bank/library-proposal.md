# Homogenaize: Unified LLM Provider Library Proposal

## Executive Summary

Homogenaize is a TypeScript-native library that provides a unified, type-safe interface for interacting with major LLM providers (OpenAI, Anthropic, Google Gemini). The key differentiator is **first-class support for structured outputs and forced tool calls**, addressing the limitations of existing libraries.

## Problem Statement

Based on the analysis of your colleague's codebase:

1. Existing libraries like `@themaximalist/llm.js` provide basic unification but lack robust structured output support
2. No reliable way to force LLM providers to use tool calls when needed
3. Type safety is incomplete, especially for structured responses
4. Each provider handles structured outputs differently, requiring manual workarounds

## Core Design Principles

1. **Type-First Development**: Full TypeScript support with Zod schema validation
2. **Provider Parity**: Abstract provider differences while exposing provider-specific features
3. **Structured by Default**: Make structured outputs and tool calls the primary use case
4. **Runtime Validation**: Ensure responses match expected schemas
5. **Developer Experience**: Simple API with powerful capabilities

## Proposed API Design

### Basic Usage

```typescript
import { createLLM } from 'homogenaize';
import { z } from 'zod';

// Initialize with provider
const llm = createLLM({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
});

// Simple chat completion
const response = await llm.chat({
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello!' },
  ],
});
```

### Structured Output (Key Feature)

```typescript
// Define your schema
const analysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  topics: z.array(z.string()),
  summary: z.string().max(200),
});

// Get typed, validated response
const analysis = await llm.chat({
  messages: [{ role: 'user', content: 'I love this new TypeScript library!' }],
  schema: analysisSchema, // ✨ Response will be typed and validated
});

// TypeScript knows: analysis.sentiment is 'positive' | 'negative' | 'neutral'
console.log(analysis.sentiment, analysis.confidence);
```

### Forced Tool Calls (Key Feature)

```typescript
// Define tools with Zod schemas
const weatherTool = llm.defineTool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  schema: z.object({
    location: z.string().describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  // Actual implementation
  execute: async ({ location, units }) => {
    // Fetch weather data
    return { temp: 20, condition: 'sunny' };
  },
});

// Force tool usage - key differentiator!
const result = await llm.chat({
  messages: [{ role: 'user', content: "What's the weather in Paris?" }],
  tools: [weatherTool],
  toolChoice: 'required', // ✨ Forces the LLM to use a tool
});

// Automatic tool execution
if (result.toolCalls) {
  const weatherData = await llm.executeTools(result.toolCalls);
  // Continue conversation with tool results
}
```

### Provider-Specific Features with Type Safety

```typescript
// Solution 1: Provider-specific factory functions with branded types
const llm = createAnthropicLLM({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
});

// TypeScript knows this is AnthropicLLM
const response = await llm.chat({
  messages: [{ role: 'user', content: 'Solve this complex problem...' }],
  features: {
    thinking: true, // ✅ TypeScript allows this for Anthropic
  },
});

// response.thinking is typed as string | undefined
console.log('Claude thought:', response.thinking);

// Solution 2: Type-safe provider configuration with conditional types
const llm = createLLM({
  provider: 'anthropic' as const, // Note the 'as const'
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
});

// TypeScript infers this is LLMClient<'anthropic'>
const response = await llm.chat({
  messages: [{ role: 'user', content: 'Solve this complex problem...' }],
  features: {
    thinking: true, // ✅ Allowed for 'anthropic' provider
    // TypeScript would error if you tried OpenAI-only features
  },
});

// Solution 3: Provider-aware method chaining
const response = await llm
  .asAnthropic() // Returns AnthropicLLM type
  .withThinking() // Now available
  .chat({
    messages: [{ role: 'user', content: 'Solve this complex problem...' }],
  });
```

### Streaming with Structured Output

```typescript
const stream = await llm.stream({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  schema: z.object({
    title: z.string(),
    chapters: z.array(
      z.object({
        number: z.number(),
        content: z.string(),
      }),
    ),
  }),
});

// Partial object validation as it streams
for await (const partial of stream) {
  if (partial.title) {
    console.log('Title:', partial.title);
  }
  // TypeScript knows partial structure
}

const final = await stream.complete(); // Fully validated result
```

## Type System Design

### Provider-Specific Type Safety

The library uses advanced TypeScript features to ensure provider-specific features are type-safe:

```typescript
// Base types
type Provider = 'openai' | 'anthropic' | 'gemini';

// Provider-specific feature types
interface ProviderFeatures {
  openai: {
    logprobs?: boolean;
    topLogprobs?: number;
  };
  anthropic: {
    thinking?: boolean;
    cacheControl?: boolean;
  };
  gemini: {
    safetySettings?: SafetySettings[];
    generationConfig?: GenerationConfig;
  };
}

// Provider-specific response types
interface ProviderResponses {
  openai: {
    logprobs?: number[];
  };
  anthropic: {
    thinking?: string;
    cacheInfo?: CacheInfo;
  };
  gemini: {
    safetyRatings?: SafetyRating[];
  };
}

// Main client type with conditional types
export class LLMClient<P extends Provider> {
  async chat<T = string>(options: ChatOptions<P>): Promise<ChatResponse<P, T>> {
    // Implementation
  }
}

// Chat options with provider-specific features
interface ChatOptions<P extends Provider> {
  messages: Message[];
  schema?: z.ZodSchema;
  features?: ProviderFeatures[P]; // Only allows features for the specific provider
}

// Response type with provider-specific fields
type ChatResponse<P extends Provider, T = string> = {
  content: T;
  usage: Usage;
} & ProviderResponses[P]; // Adds provider-specific fields

// Factory functions ensure correct typing
export function createLLM<P extends Provider>(config: {
  provider: P;
  apiKey: string;
  model: string;
}): LLMClient<P> {
  // Returns correctly typed client
}

// Provider-specific factories for better DX
export function createOpenAILLM(config: Omit<Config, 'provider'>): LLMClient<'openai'> {
  return createLLM({ ...config, provider: 'openai' });
}

export function createAnthropicLLM(config: Omit<Config, 'provider'>): LLMClient<'anthropic'> {
  return createLLM({ ...config, provider: 'anthropic' });
}
```

### Type Inference Examples

```typescript
// Example 1: Generic createLLM with const assertion
const llm = createLLM({
  provider: 'anthropic' as const,
  apiKey: 'key',
  model: 'claude-3'
});

// TypeScript knows: llm is LLMClient<'anthropic'>
const response = await llm.chat({
  messages: [...],
  features: {
    thinking: true, // ✅ Allowed
    logprobs: true, // ❌ Error: 'logprobs' does not exist in type 'ProviderFeatures["anthropic"]'
  }
});

// response.thinking is available and typed as string | undefined
if (response.thinking) {
  console.log(response.thinking); // TypeScript knows this is a string
}

// Example 2: Provider-specific factory
const openai = createOpenAILLM({
  apiKey: 'key',
  model: 'gpt-4'
});

const response = await openai.chat({
  messages: [...],
  features: {
    logprobs: true, // ✅ Allowed for OpenAI
    thinking: true, // ❌ Error: Property 'thinking' does not exist
  }
});

// Example 3: Runtime provider switching with type narrowing
function createDynamicLLM(provider: Provider) {
  const config = { provider, apiKey: 'key', model: 'model' };

  switch (provider) {
    case 'anthropic':
      return createAnthropicLLM(config); // Returns LLMClient<'anthropic'>
    case 'openai':
      return createOpenAILLM(config); // Returns LLMClient<'openai'>
    case 'gemini':
      return createGeminiLLM(config); // Returns LLMClient<'gemini'>
  }
}

// Example 4: Unknown provider at compile time
const providerFromConfig = getProviderFromUserConfig(); // Returns Provider
const llm = createLLM({
  provider: providerFromConfig, // Type is Provider (union)
  apiKey: 'key',
  model: 'model'
});

// For unknown providers, use runtime checks
const response = await llm.chat({
  messages: [...],
  features: {
    // Must use type assertions or runtime checks
    ...(providerFromConfig === 'anthropic' ? { thinking: true } : {}),
    ...(providerFromConfig === 'openai' ? { logprobs: true } : {}),
  }
});

// Type guard functions for response handling
function hasThinking(
  response: ChatResponse<Provider>
): response is ChatResponse<'anthropic'> & { thinking: string } {
  return 'thinking' in response && response.thinking !== undefined;
}

if (hasThinking(response)) {
  console.log(response.thinking); // TypeScript knows this exists
}
```

## Implementation Strategy

### 1. Core Architecture

```typescript
// Provider abstraction
interface Provider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamChunk>;
  forceToolUse(tools: Tool[], message: Message): ChatRequest;
  supportsFeature(feature: Feature): boolean;
}

// Provider implementations
class OpenAIProvider implements Provider {
  // Handle OpenAI-specific structured outputs
  // Use response_format: { type: "json_schema", json_schema: ... }
}

class AnthropicProvider implements Provider {
  // Handle Claude's tool use format
  // Use tool_choice: { type: "tool", name: "..." }
}

class GeminiProvider implements Provider {
  // Handle Gemini's function calling
  // Use tool_config: { function_calling_config: { mode: "ANY" } }
}
```

### 2. Schema Validation Layer

```typescript
class SchemaValidator<T extends z.ZodSchema> {
  constructor(private schema: T) {}

  async validateStreaming(chunks: AsyncIterable<any>): AsyncIterable<Partial<z.infer<T>>> {
    // Progressive validation as data streams
  }

  validate(data: unknown): z.infer<T> {
    return this.schema.parse(data);
  }
}
```

### 3. Tool System

```typescript
class ToolManager {
  private tools = new Map<string, ToolDefinition>();

  defineTool<T extends z.ZodSchema>(config: {
    name: string;
    description: string;
    schema: T;
    execute: (params: z.infer<T>) => Promise<any>;
  }) {
    // Register tool with validation
  }

  async executeTool(call: ToolCall) {
    const tool = this.tools.get(call.name);
    const params = tool.schema.parse(call.arguments);
    return tool.execute(params);
  }
}
```

## Provider-Specific Implementation Details

### OpenAI

- Use `response_format` with JSON schema for structured outputs
- Use `tool_choice: "required"` to force tool usage
- Support parallel tool calls
- Handle strict mode for functions

### Anthropic

- Use `tool_choice: { type: "tool", name: "specific_tool" }` to force specific tool
- Support thinking tokens with proper role handling
- Handle Claude's specific tool result format

### Google Gemini

- Use `response_mime_type: "application/json"` with `response_schema`
- Use `tool_config` with `function_calling_config.mode: "ANY"`
- Handle Gemini's different message format

## Key Features

1. **Unified Structured Output**
   - Single schema definition works across all providers
   - Automatic validation with helpful error messages
   - TypeScript inference from schemas

2. **Forced Tool Usage**
   - Require LLM to use tools when appropriate
   - Provider-specific implementations hidden from user
   - Automatic tool execution pipeline

3. **Type Safety**
   - Full TypeScript support with generics
   - Zod schema integration
   - Compile-time type checking for responses

4. **Provider Transparency**
   - Access provider-specific features when needed
   - Know which features are available per provider
   - Graceful fallbacks for unsupported features

5. **Error Handling**
   - Unified error types across providers
   - Retry logic with exponential backoff
   - Detailed error context for debugging

## Migration Path

For users of `@themaximalist/llm.js`:

```typescript
// Before (llm.js)
const response = await LLM.prompt(messages, {
  json: true,
  tools: toolsArray,
});
// Manual validation needed
const validated = schema.parse(response);

// After (homogenaize)
const response = await llm.chat({
  messages,
  schema, // Automatic validation
  tools: toolsArray,
  toolChoice: 'required', // Force tool use!
});
// response is already typed and validated
```

## Development Roadmap

### Phase 1: Core Foundation (Week 1-2)

- [x] Project setup with TypeScript, Vitest, Zod
- [x] Provider interface definition
- [x] Basic OpenAI implementation
- [x] Schema validation system

### Phase 2: Structured Outputs (Week 3-4)

- [x] OpenAI structured output support
- [x] Anthropic structured output support
- [x] Gemini structured output support
- [x] Streaming with partial validation

### Phase 3: Tool System (Week 5-6)

- [x] Tool definition API
- [x] Forced tool usage implementation
- [x] Tool execution pipeline
- [x] Multi-tool support

### Phase 4: Advanced Features (Week 7-8)

- [x] Provider-specific features
- [ ] Retry and error handling
- [ ] Caching layer
- [ ] Usage tracking and limits

### Phase 5: Polish and Release (Week 9-10)

- [ ] Comprehensive documentation
- [ ] Migration guides
- [ ] Performance optimization
- [ ] npm package release

## Success Metrics

1. **Developer Experience**
   - Less code than direct SDK usage
   - Type inference "just works"
   - Clear error messages

2. **Reliability**
   - 99%+ successful schema validation
   - Consistent behavior across providers
   - Predictable tool usage

3. **Performance**
   - Minimal overhead vs direct SDK
   - Efficient streaming
   - Smart retries

## Conclusion

Homogenaize addresses the critical gap in existing LLM libraries by providing first-class support for structured outputs and forced tool calls. By focusing on type safety and developer experience, it will become the go-to solution for TypeScript developers building LLM-powered applications.
