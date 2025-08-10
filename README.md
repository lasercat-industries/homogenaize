# Homogenaize

A TypeScript-native library that provides a unified interface for multiple LLM providers (OpenAI, Anthropic, Gemini), with full type safety and runtime validation using Zod and JSON Schema.

## Features

- 🔥 **Unified API** - Single interface for OpenAI, Anthropic, and Gemini
- 🛡️ **Type Safety** - Full TypeScript support with provider-specific features
- 🎨 **Typed Model Names** - Autocomplete and compile-time validation for model names
- ✅ **Runtime Validation** - Zod schemas and JSON Schema for structured outputs
- 📐 **JSON Schema Support** - Use typed `JSONSchemaType<T>` or generic JSON Schema alongside Zod
- 🔄 **Streaming Support** - Async iterators for real-time responses
- 🛠️ **Tool Calling** - Define and execute tools with automatic validation
- 🎯 **Provider Features** - Access provider-specific capabilities while maintaining type safety
- 🔁 **Retry Logic** - Built-in exponential backoff with configurable retry strategies
- 📋 **Model Discovery** - List available models for each provider
- 🧠 **Thinking Tokens** - Support for Anthropic's thinking tokens feature
- 📊 **Structured Logging** - Configurable Winston logging with automatic sensitive data redaction

## Installation

```bash
bun add homogenaize
# or
npm install homogenaize
# or
yarn add homogenaize
```

## Quick Start

```typescript
import { createLLM, createOpenAILLM, createAnthropicLLM, createGeminiLLM } from 'homogenaize';

// Option 1: Generic client (recommended for flexibility)
const client = createLLM({
  provider: 'openai', // or 'anthropic' or 'gemini'
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini', // ✨ Typed! Autocompletes valid models
});

// Option 2: Provider-specific clients (for better type hints)
const openai = createOpenAILLM({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini', // ✨ Only OpenAI models allowed
});

const anthropic = createAnthropicLLM({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-sonnet-20240229', // ✨ Only Anthropic models allowed
});

const gemini = createGeminiLLM({
  apiKey: process.env.GEMINI_API_KEY!,
  model: 'gemini-1.5-pro', // ✨ Only Gemini models allowed
});

// Use the same interface for all providers
const response = await client.chat({
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello!' },
  ],
  temperature: 0.7,
});

console.log(response.content);
```

## Generic API (Provider Type Pollution Avoidance)

If you want to avoid provider types spreading throughout your codebase (at the cost of compile-time model validation), use the Generic API:

```typescript
import {
  createGenericLLM,
  createGenericOpenAI,
  createGenericAnthropic,
  createGenericGemini,
} from 'homogenaize';

// Generic API - no provider type parameters needed
const client = createGenericLLM({
  provider: 'openai', // Runtime provider selection
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4', // Any string accepted (no compile-time validation)
});

// Provider-specific generic factories
const openai = createGenericOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4', // Any string model name
});

// Switch providers at runtime without type changes
function createClient(provider: string) {
  return createGenericLLM({
    provider: provider as any,
    apiKey: getApiKey(provider),
    model: getModel(provider),
  });
}

// Same interface, no type pollution
const response = await client.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Still supports all features (schemas, tools, streaming)
const structuredResponse = await client.chat({
  messages: [{ role: 'user', content: 'Generate data' }],
  schema: MyZodSchema, // Still works with Zod/JSON Schema
});
```

### When to Use Generic vs Type-Safe API

**Use the Type-Safe API when:**

- You want compile-time validation of model names
- You need IDE autocomplete for provider-specific features
- You're working with a single provider
- Type safety is more important than flexibility

**Use the Generic API when:**

- You need to switch providers dynamically at runtime
- You want to avoid provider types in your function signatures
- You're building provider-agnostic abstractions
- You're willing to trade compile-time safety for flexibility

## Structured Outputs

Define schemas using Zod or JSON Schema and get validated, typed responses from any provider:

### Using Zod Schemas

```typescript
import { z } from 'zod';
import { createLLM } from 'homogenaize';

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
  occupation: z.string(),
  hobbies: z.array(z.string()),
});

const client = createLLM({
  provider: 'openai', // or 'anthropic' or 'gemini'
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});

// Get validated, typed responses
const response = await client.chat({
  messages: [{ role: 'user', content: 'Generate a random person profile' }],
  schema: PersonSchema,
});

// response.content is fully typed as { name: string, age: number, occupation: string, hobbies: string[] }
console.log(response.content.name); // TypeScript knows this is a string
console.log(response.content.hobbies[0]); // TypeScript knows this is a string[]
```

### Using JSON Schema

You can use JSON Schema with full TypeScript type safety using AJV's `JSONSchemaType`:

```typescript
import type { JSONSchemaType } from 'ajv';
import { createLLM } from 'homogenaize';

interface PersonData {
  name: string;
  age: number;
  occupation: string;
  hobbies: string[];
}

// Typed JSON Schema - provides compile-time type checking
const PersonSchema: JSONSchemaType<PersonData> = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
    occupation: { type: 'string' },
    hobbies: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['name', 'age', 'occupation', 'hobbies'],
  additionalProperties: false,
};

const client = createLLM({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-sonnet-20240229',
});

// Get validated, typed responses with JSON Schema
const response = await client.chat({
  messages: [{ role: 'user', content: 'Generate a random person profile' }],
  schema: PersonSchema,
});

// response.content is fully typed as PersonData
console.log(response.content.name); // TypeScript knows this is a string
console.log(response.content.age); // TypeScript knows this is a number
```

### Using Generic JSON Schema

For dynamic schemas or when type safety isn't required:

```typescript
import { createLLM } from 'homogenaize';

// Generic JSON Schema without compile-time type checking
const DynamicSchema = {
  type: 'object',
  properties: {
    result: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['result', 'confidence'],
};

const client = createLLM({
  provider: 'gemini',
  apiKey: process.env.GEMINI_API_KEY!,
  model: 'gemini-1.5-pro',
});

const response = await client.chat({
  messages: [{ role: 'user', content: 'Analyze this text and provide results' }],
  schema: DynamicSchema,
});

// response.content is typed as unknown when using generic schemas
// You'll need to cast or validate the type yourself
const data = response.content as { result: string; confidence: number; tags?: string[] };
console.log(data.result);
```

## Streaming Responses

```typescript
const stream = await client.stream({
  messages: [{ role: 'user', content: 'Write a short story' }],
  maxTokens: 1000,
});

// Stream chunks as they arrive
for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// Get the complete response with usage stats
const complete = await stream.complete();
console.log(`Total tokens used: ${complete.usage.totalTokens}`);
```

## Tool Calling

```typescript
// Define a tool with schema validation
const weatherTool = client.defineTool({
  name: 'get_weather',
  description: 'Get the current weather for a location',
  schema: z.object({
    location: z.string().describe('City and country'),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  execute: async (params) => {
    // Your implementation here
    return { temperature: 22, condition: 'sunny', location: params.location };
  },
});

// Let the model decide when to use tools
const response = await client.chat({
  messages: [{ role: 'user', content: "What's the weather in Paris?" }],
  tools: [weatherTool],
  toolChoice: 'auto', // or 'required' to force tool use
});

// Execute any tool calls
if (response.toolCalls) {
  const results = await client.executeTools(response.toolCalls);
  console.log('Tool results:', results);
  // Example result:
  // [
  //   {
  //     toolCallId: 'call-123',
  //     toolName: 'get_weather',
  //     result: { temperature: 22, condition: 'sunny', location: 'Paris' }
  //   }
  // ]
}
```

## List Available Models

Discover available models for each provider:

```typescript
// List models for a specific provider
const models = await client.listModels();

// Example response
[
  { id: 'gpt-4', name: 'gpt-4', created: 1687882411 },
  { id: 'gpt-3.5-turbo', name: 'gpt-3.5-turbo', created: 1677610602 },
  // ... more models
];

// Use the scripts to list all models across providers
// Run: bun run list-models
// Output: JSON with all models from all configured providers

// Or list only chat models
// Run: bun run list-chat-models
// Output: Filtered list of chat-capable models
```

## Retry Configuration

Configure automatic retries with exponential backoff:

```typescript
import { createLLM } from 'homogenaize';

const client = createLLM({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
  retry: {
    maxRetries: 3, // Maximum number of retry attempts (default: 3)
    initialDelay: 1000, // Initial delay in ms (default: 1000)
    maxDelay: 60000, // Maximum delay in ms (default: 60000)
    backoffMultiplier: 2, // Exponential backoff multiplier (default: 2)
    jitter: true, // Add randomness to delays (default: true)
    onRetry: (attempt, error, delay) => {
      console.log(`Retry attempt ${attempt} after ${delay}ms due to:`, error.message);
    },
  },
});

// The client will automatically retry on:
// - Rate limit errors (429)
// - Server errors (5xx)
// - Network errors (ECONNRESET, ETIMEDOUT, etc.)
// - Provider-specific transient errors

// You can also customize which errors trigger retries
const customClient = createLLM({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-sonnet-20240229',
  retry: {
    maxRetries: 5,
    retryableErrors: (error) => {
      // Custom logic to determine if an error should be retried
      return error.message.includes('temporary') || error.status === 503;
    },
  },
});
```

## Provider-Specific Features

Access provider-specific features while maintaining type safety:

```typescript
// OpenAI-specific features
const openaiResponse = await openai.chat({
  messages: [{ role: 'user', content: 'Hello' }],
  features: {
    logprobs: true,
    topLogprobs: 2,
    seed: 12345,
  },
});

// Access logprobs if available
if (openaiResponse.logprobs) {
  console.log('Token probabilities:', openaiResponse.logprobs);
}

// Anthropic-specific features
const anthropicResponse = await anthropic.chat({
  messages: [{ role: 'user', content: 'Hello' }],
  features: {
    thinking: true,
    cacheControl: true,
  },
});

// Gemini-specific features
const geminiResponse = await gemini.chat({
  messages: [{ role: 'user', content: 'Hello' }],
  features: {
    safetySettings: [
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_ONLY_HIGH',
      },
    ],
  },
});
```

## Thinking Tokens (Anthropic)

Anthropic's thinking tokens feature allows Claude to show its reasoning process before generating a response. This is particularly useful for complex problem-solving tasks.

```typescript
import { createAnthropicLLM } from 'homogenaize';

const anthropic = createAnthropicLLM({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-opus-20240229',
});

// Enable thinking tokens
const response = await anthropic.chat({
  messages: [
    {
      role: 'user',
      content:
        'Solve this step by step: If a train travels at 60 mph for 2.5 hours, how far does it go?',
    },
  ],
  features: {
    thinking: true,
    maxThinkingTokens: 1000, // Optional: limit thinking tokens
  },
});

// Access the thinking process
if (response.thinking) {
  console.log("Claude's thought process:", response.thinking);
}
console.log('Final answer:', response.content);

// Example output:
// Claude's thought process: "I need to calculate distance using the formula distance = speed × time. Speed is 60 mph, time is 2.5 hours..."
// Final answer: "The train travels 150 miles."
```

### Thinking Tokens in Streaming

When streaming, thinking tokens are handled separately and won't be yielded as part of the regular content stream:

```typescript
const stream = await anthropic.stream({
  messages: [{ role: 'user', content: 'Explain quantum entanglement' }],
  features: {
    thinking: true,
  },
});

// Regular content stream (no thinking tokens here)
for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// Get thinking tokens from the complete response
const complete = await stream.complete();
if (complete.thinking) {
  console.log('\nThought process:', complete.thinking);
}
```

Note: Thinking tokens are only available with Anthropic's Claude models and require specific model versions that support this feature.

## Logging

Homogenaize includes a powerful logging system built on Winston that provides detailed insights into library operations while maintaining zero noise by default.

### Basic Configuration

```typescript
// Enable logging with default settings (info level)
const client = createLLM({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
  logging: true,
});

// Or disable logging explicitly
const client = createLLM({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-sonnet-20240229',
  logging: false, // Default behavior - no logs
});
```

### Advanced Configuration

```typescript
import { createLLM } from 'homogenaize';

const client = createLLM({
  provider: 'gemini',
  apiKey: process.env.GEMINI_API_KEY!,
  model: 'gemini-1.5-pro',
  logging: {
    level: 'debug', // error, warn, info, debug, verbose, silent
    format: 'json', // json or pretty (default: pretty)
    prefix: '[MyApp]', // Optional prefix for all log messages
  },
});

// Example log output (pretty format):
// 2024-01-15T10:30:45.123Z [info]: [MyApp] Creating LLM client {"provider":"gemini","model":"gemini-1.5-pro"}
// 2024-01-15T10:30:45.456Z [debug]: [MyApp] Transformed request for Gemini API {"contentCount":1,"hasTools":false}
```

### Environment Variables

Configure logging globally using environment variables:

```bash
# Set log level
export HOMOGENAIZE_LOG_LEVEL=debug

# Set output format
export HOMOGENAIZE_LOG_FORMAT=json

# Run your application
node app.js
```

### Log Levels

- **error**: API failures, network errors, validation failures
- **warn**: Rate limit warnings, deprecated features, recoverable errors
- **info**: Request/response summaries, token usage, model selection
- **debug**: Request transformation, schema validation, retry attempts
- **verbose**: Full request/response bodies, detailed transformations
- **silent**: No logging (default)

### Custom Transports

For production environments, you can configure custom Winston transports:

```typescript
import winston from 'winston';
import { createLLM } from 'homogenaize';

const client = createLLM({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
  logging: {
    level: 'info',
    format: 'json',
    transports: [
      new winston.transports.File({
        filename: 'llm-errors.log',
        level: 'error',
      }),
      new winston.transports.File({
        filename: 'llm-combined.log',
      }),
      new winston.transports.Console({
        format: winston.format.simple(),
      }),
    ],
  },
});
```

### Security Features

The logging system automatically redacts sensitive information:

- API keys (OpenAI, Anthropic, Gemini formats)
- Tokens and secrets
- Password fields
- Any field with 'key', 'token', 'secret', or 'password' in the name

Example:

```typescript
// This will be logged as:
// API Key: ***REDACTED***
// Instead of showing the actual key
```

### What Gets Logged

**Provider Operations:**

- Request initiation with model and provider info
- Response completion with token usage
- API errors with status codes and retry information
- Streaming events and completion

**Client Operations:**

- Client creation with configuration
- Tool definitions and executions
- Request routing and transformations

**Retry Logic:**

- Retry attempts with backoff calculations
- Rate limit handling
- Final success or failure

## Building Abstractions

The library exports option types for all client methods, making it easy to build abstractions:

```typescript
import { ChatOptions, StreamOptions, LLMClient } from 'homogenaize';

// Create reusable chat functions with proper typing
async function chatWithRetry<T>(
  client: LLMClient<'openai'>,
  options: ChatOptions<'openai', T>,
  maxRetries = 3,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await client.chat(options);
      return response.content;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries reached');
}

// Build middleware functions
function withLogging<P extends ProviderName>(options: ChatOptions<P>): ChatOptions<P> {
  console.log('Chat request:', options);
  return options;
}

// Type-safe wrappers for specific use cases
class ConversationManager<P extends ProviderName> {
  constructor(private client: LLMClient<P>) {}

  async ask(options: Omit<ChatOptions<P>, 'messages'> & { message: string }) {
    const chatOptions: ChatOptions<P> = {
      ...options,
      messages: [{ role: 'user', content: options.message }],
    };
    return this.client.chat(chatOptions);
  }
}
```

### Available Option Types

- `ChatOptions<P, T>` - Options for the chat method
- `StreamOptions<P, T>` - Options for the stream method (same as ChatOptions)
- `DefineToolOptions<T>` - Options for defining tools
- `ExecuteToolsOptions` - Array of tool calls to execute

## API Reference

### Creating Clients

```typescript
// Generic client creation (recommended)
createLLM(config: {
  provider: 'openai' | 'anthropic' | 'gemini';
  apiKey: string;
  model: string;
  defaultOptions?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
})

// Provider-specific clients (for better type inference)
createOpenAILLM(config: {
  apiKey: string;
  model: string;
  defaultOptions?: { /* same options */ };
})

createAnthropicLLM(config: { /* same as above */ })
createGeminiLLM(config: { /* same as above */ })
```

### Chat Methods

```typescript
// Basic chat
client.chat(options: {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  schema?: ZodSchema | JSONSchemaType<T> | JSONSchema;
  tools?: Tool[];
  toolChoice?: 'auto' | 'required' | 'none';
  features?: ProviderSpecificFeatures;
})

// Streaming chat
client.stream(options: { /* same as chat */ })
```

### Tool Methods

```typescript
// Define a tool
client.defineTool(config: {
  name: string;
  description: string;
  schema: ZodSchema;
  execute: (params: any) => Promise<any>;
})

// Execute tool calls
client.executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]>

// ToolResult interface
interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error?: string;
}
```

## Environment Variables

```bash
# Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AI...
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run specific test file
bun test src/providers/openai/openai.test.ts

# Run with API keys for integration tests
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GEMINI_API_KEY=... bun test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
