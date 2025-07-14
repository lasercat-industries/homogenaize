# Homogenaize

A TypeScript-native library that provides a unified interface for multiple LLM providers (OpenAI, Anthropic, Gemini), with full type safety and runtime validation using Zod.

## Features

- 🔥 **Unified API** - Single interface for OpenAI, Anthropic, and Gemini
- 🛡️ **Type Safety** - Full TypeScript support with provider-specific features
- ✅ **Runtime Validation** - Zod schemas for structured outputs
- 🔄 **Streaming Support** - Async iterators for real-time responses
- 🛠️ **Tool Calling** - Define and execute tools with automatic validation
- 🎯 **Provider Features** - Access provider-specific capabilities while maintaining type safety

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
  model: 'gpt-4o-mini',
});

// Option 2: Provider-specific clients (for better type hints)
const openai = createOpenAILLM({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
});

const anthropic = createAnthropicLLM({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-sonnet-20240229',
});

const gemini = createGeminiLLM({
  apiKey: process.env.GEMINI_API_KEY!,
  model: 'gemini-1.5-pro',
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

## Structured Outputs with Zod

Define a schema and get validated, typed responses from any provider:

```typescript
import { z } from 'zod';
import { createLLM } from 'homogenaize';

const PersonSchema = z.object({
  name: z.string(),
  age: z.number(),
  occupation: z.string(),
  hobbies: z.array(z.string()),
});

// Works with the generic createLLM function
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

// Also works with provider-specific clients
const anthropic = createAnthropicLLM({
  /* ... */
});
const anthropicResponse = await anthropic.chat({
  messages: [{ role: 'user', content: 'Generate a person profile' }],
  schema: PersonSchema, // Same schema works across all providers!
});
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
}
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
  schema?: ZodSchema;
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
