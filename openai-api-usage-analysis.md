# OpenAI API Usage Analysis - Lasermonkey

This document provides a comprehensive analysis of OpenAI API usage in the Lasermonkey Chrome extension project, including patterns, examples, types, and considerations for building a unified LLM provider library.

## Overview

Lasermonkey uses OpenAI APIs through two main approaches:
1. **LLM.js Wrapper** - Primary interface for AI interactions
2. **Direct OpenAI SDK** - Limited to build-time model information generation

## Type System Overview

The project uses a comprehensive type system built on:
- **@themaximalist/llm.js** types for core LLM interactions
- **Zod schemas** for runtime validation with `z.strictObject()`
- **Custom interfaces** for streaming, tools, and domain-specific needs

## Core Types and Interfaces

### 1. LLM.js Core Types

```typescript
import LLM, {
  type Input,              // string | Message[]
  type Options,            // Configuration options for LLM calls
  type LLMServices,        // Union of all LLM service types
  type ModelUsageType,     // Model usage information
} from '@themaximalist/llm.js';

// Message types
type Message = {
  role: MessageRole;
  content: MessageContent;
};

type MessageRole = "user" | "assistant" | "system" | "thinking" | "tool_call";
type MessageContent = string | Tool | any;

// Configuration options
type Options = {
  service?: string;
  model?: string;
  stream?: boolean;
  json?: boolean;
  max_tokens?: number;
  temperature?: number;
  apikey?: string;
  // ... other provider-specific options
};

// Streaming types
type StreamingResult = {
  [Symbol.asyncIterator](): AsyncIterator<string>;
  complete(): Promise<void>;
};
```

### 2. Custom Domain Types

```typescript
// Page analysis types
export const annotationCandidateSchema = z.object({
  id: z.string({ message: 'ID must be a string' }),
  text: z.string({ message: 'Text must be a string' }),
  selector: z.string({ message: 'Selector must be a string' }),
});

export const annotationResultSchema = z.object({
  id: z.string({ message: 'Annotation ID must be a string' }),
  relevanceScore: z
    .number({ message: 'Relevance score must be a number' })
    .min(0, { message: 'Relevance score must be at least 0' })
    .max(100, { message: 'Relevance score must not exceed 100' }),
  reason: z.string({ message: 'Reason must be a string' }),
}).catchall(z.any().optional());

export const analysisResultsSchema = z.object({
  annotations: z.array(annotationResultSchema),
});

// Type definitions
export type AnnotationCandidate = z.infer<typeof annotationCandidateSchema>;
export type AnnotationResult = z.infer<typeof annotationResultSchema>;
export type Annotation = AnnotationCandidate & AnnotationResult;
export type AnalysisResults = z.infer<typeof analysisResultsSchema>;
```

### 3. Tool System Types

```typescript
// OpenAI function tool format
export const functionToolSchema = z.object({
  type: z.literal('function'),
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.any()),
  strict: z.boolean(),
});

export type FunctionTool = z.infer<typeof functionToolSchema>;

// Tool result types
export interface ToolSuccess<T = unknown> {
  success: true;
  result: T;
  metadata?: Record<string, unknown>;
}

export interface ToolError {
  success: false;
  error: string;
  code?: string;
  stack?: string;
  context?: Record<string, unknown>;
  recoverable?: boolean;
}

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolError;
```

### 4. Agent Configuration Types

```typescript
// Page analysis options
export type PageAnalysisOptions = {
  prompt: string;
  tools: FunctionTool[];
  annotations: AnnotationCandidate[];
  tab: TabWithId;
};

// Highlight summarizer options
export type HighlightSummarizerOptions = {
  query: string;
  elements: ElementMetadata[];
  tab: { id: number };
};
```

## 1. LLM.js Wrapper Usage

The project primarily uses `@themaximalist/llm.js` as an abstraction layer over multiple LLM providers.

### Configuration with Types

```typescript
// src/background/ai.ts
import LLM from '@themaximalist/llm.js';
import type { Options } from '@themaximalist/llm.js';

// Extended options with required fields
type DefaultOptions = Options & Required<Pick<Options, 'service' | 'model' | 'apiKey'>>;

// Default configuration
const defaultOptions: DefaultOptions = {
  service: 'openai',
  model: 'gpt-4.1-mini',
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  max_tokens: 32000,
};

// Runtime configuration from Chrome storage
const settings = await chrome.storage.local.get(['service', 'model', 'apiKey', 'maximumOutputTokens']);
const aiOptions: Options = {
  service: settings.service ?? defaultOptions.service,
  model: settings.model ?? defaultOptions.model,
  apikey: settings.apiKey ?? defaultOptions.apiKey,
  max_tokens: settings.maximumOutputTokens ?? defaultOptions.max_tokens,
};
```

### Usage Patterns

#### 1. Standard Chat Completion with JSON Mode and Types

```typescript
// src/background/agents/page-analysis.ts
import type { Message } from '@themaximalist/llm.js';

const messages: Message[] = [
  {
    role: 'system',
    content: 'You are a helpful assistant that analyzes web pages...',
  },
  {
    role: 'user',
    content: `Analyze this page content: ${pageContent}`,
  },
];

const response = await AI.prompt(messages, { json: true }); // Forces JSON response format

// Response is automatically parsed when json: true
// Validate with Zod schema
const validatedResponse = analysisResultsSchema.parse(response);
const annotations: AnalysisResults['annotations'] = validatedResponse.annotations;
```

#### 2. Streaming Responses with Type Support

```typescript
// src/background/agents/highlight-summarizer.ts
import type { StreamingResult } from '@/background/ai';

const response: StreamingResult = await AI.prompt(
  [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
  { stream: true }
);

// Process streaming chunks with async iterator
for await (const chunk: string of response) {
  // Each chunk is a partial response
  console.log(chunk);
}

// Wait for completion if needed
await response.complete();
```

#### 3. Batch Processing

```typescript
// src/background/agents/page-analysis.ts
async function analyzePageContent(htmlChunks: string[], batchSize: number) {
  const results = [];
  
  for (let i = 0; i < htmlChunks.length; i += batchSize) {
    const batch = htmlChunks.slice(i, i + batchSize);
    const combinedHtml = batch.join('\n\n');
    
    try {
      const response = await AI.prompt(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze: ${combinedHtml}` },
        ],
        { json: true }
      );
      results.push(...response);
    } catch (error) {
      console.error(`Batch ${i} failed:`, error);
      // Continue processing other batches
    }
  }
  
  return results;
}
```

## 2. Direct OpenAI SDK Usage

Direct SDK usage is limited to build-time scripts:

```typescript
// scripts/generate-model-information.ts
import OpenAI from 'openai';

async function fetchOpenAIModels(apiKey: string) {
  const openai = new OpenAI({ apiKey });
  const models = await openai.models.list();
  
  return models.data.map(model => ({
    id: model.id,
    name: model.id,
    provider: 'openai',
    capabilities: {
      vision: model.id.includes('vision') || model.id.includes('gpt-4o'),
      tools: !model.id.includes('embedding') && !model.id.includes('tts'),
      systemPrompt: true,
    },
    contextWindow: getContextWindow(model.id),
  }));
}
```

## 3. Tool System Integration with Full Type Support

The project prepares tools for OpenAI function calling format:

```typescript
// src/tools/tool.ts
import type { z } from 'zod/v4';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type ToolSchemaShape = z.ZodObject<z.ZodRawShape> | z.ZodTypeAny;

export type ToolConfiguration<N extends ToolName> = {
  name: N;
  summary: string;
  purpose: string;
  useCases: string[];
  parameters: ToolSchemaShape;
};

class Tool<T extends ToolSchemaShape = ToolSchemaShape> {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly parametersSchema: T,
  ) {}

  toJSON(): FunctionTool {
    return {
      type: 'function' as const,
      name: this.name,
      description: this.description,
      strict: true, // OpenAI strict mode for function calling
      parameters: zodToJsonSchema(this.parametersSchema) as Record<string, any>,
    };
  }
}

// Tool execution types
export type ToolParameters<N extends ToolName> = Parameters<ToolRegistry[N]>[0];
export type ToolReturnType<N extends ToolName> = Awaited<ReturnType<ToolRegistry[N]>>;
```

## 4. Key Patterns and Considerations

### Message Format
All messages follow OpenAI's chat format:
```typescript
type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};
```

### Response Handling

1. **JSON Mode**: Automatically parses JSON responses
2. **Streaming**: Returns async iterator for chunks
3. **Standard**: Returns complete response as string

### Error Handling
```typescript
try {
  const response = await AI.prompt(messages, options);
  // Process response
} catch (error) {
  console.error('AI request failed:', error);
  // Fallback logic
}
```

### Configuration Storage
```typescript
// Settings stored in Chrome storage
{
  service: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'sk-...',
  maximumOutputTokens: 32000,
  batchSize: 5,
}
```

## 5. Multi-Modal Considerations with Types

While the current implementation doesn't use multi-modal features, the model information system tracks vision capabilities:

```typescript
// Model capability types
export interface ModelCapability {
  id: string;
  supportsVision: boolean;
  supportsTools: boolean;
  contextWindow: number;
  trainingDataCutoff?: string;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
}

// Model capability validation schema
export const modelCapabilitySchema = z.strictObject({
  id: z.string(),
  supportsVision: z.boolean(),
  supportsTools: z.boolean(),
  contextWindow: z.number().int().positive(),
  trainingDataCutoff: z.string().optional(),
  costPer1kTokens: z
    .strictObject({
      input: z.number().positive(),
      output: z.number().positive(),
    })
    .optional(),
});

// Example model definition
const gpt4o: ModelCapability = {
  id: 'gpt-4o',
  supportsVision: true, // Supports image inputs
  supportsTools: true,
  contextWindow: 128000,
  trainingDataCutoff: '2023-10',
  costPer1kTokens: {
    input: 0.0025,
    output: 0.01,
  },
};

// Type for available models
export type AvailableModel = (typeof availableModels)[number];
```

## 6. Error Handling Types

```typescript
// Custom error types
export class ToolError extends Error {
  constructor(
    public code: ToolErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export const ToolErrorCode = {
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  INVALID_TOOL_NAME: 'INVALID_TOOL_NAME',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
} as const;

export type ToolErrorCode = typeof ToolErrorCode[keyof typeof ToolErrorCode];
```

## 7. Prompt System Types

```typescript
// Prompt context types
export type ContextValue = string | number | boolean;
export type ContextObject = Record<string, ContextValue | Record<string, ContextValue>>;

// Strongly typed prompt context mapping
export type PromptContextMap = {
  'highlight-analyzer-system-prompt': never;
  'highlight-analyzer-user-prompt': { highlights: string; query: string };
  'page-analysis-system-prompt': never;
  'page-analysis-user-prompt': { query: string; annotations: string };
};

// Prompt retrieval with type safety
export function getPrompt<K extends keyof PromptContextMap>(
  key: K,
  context?: PromptContextMap[K]
): string {
  // Implementation
}
```

## 8. Recommendations for Unified LLM Library

Based on this comprehensive type analysis, a unified LLM library should implement:

### 1. **Core Type System**
```typescript
// Base message types
export interface BaseMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MultiModalContent;
}

export interface MultiModalContent {
  type: 'text' | 'image';
  text?: string;
  url?: string;
  mimeType?: string;
}

// Provider-agnostic options
export interface UnifiedOptions {
  provider: 'openai' | 'anthropic' | 'google';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  json?: boolean;
  schema?: z.ZodSchema; // For structured outputs
  tools?: Tool[];
}

// Response types
export type UnifiedResponse<T = string> = {
  content: T;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason?: string;
};

// Streaming response type
export interface UnifiedStreamingResponse<T = string> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
  complete(): Promise<UnifiedResponse<T>>;
}
```

### 2. **Tool/Function Types**
```typescript
export interface UnifiedTool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  strict?: boolean; // For providers that support strict mode
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface UnifiedToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}
```

### 3. **Error Types**
```typescript
export class UnifiedLLMError extends Error {
  constructor(
    public provider: string,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'UnifiedLLMError';
  }
}

export const ErrorCodes = {
  INVALID_API_KEY: 'INVALID_API_KEY',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
```

### 4. **Model Capability Types**
```typescript
export interface UnifiedModelCapability {
  id: string;
  provider: string;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsJson: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}
```

## Example Usage with Full Type Safety

```typescript
// Proposed unified interface with complete type safety
import { UnifiedLLMClient } from 'unified-llm';
import { z } from 'zod';

// Initialize with type-safe configuration
const client = new UnifiedLLMClient({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini',
  maxTokens: 32000,
});

// Define response schema
const analysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  topics: z.array(z.string()),
  summary: z.string(),
});

// Structured output with automatic validation
const analysis = await client.chat<z.infer<typeof analysisSchema>>({
  messages: [
    { role: 'system', content: 'Analyze the sentiment and extract topics.' },
    { role: 'user', content: 'I love this new TypeScript library!' },
  ],
  json: true,
  schema: analysisSchema,
});
// analysis is fully typed as { sentiment: 'positive' | 'negative' | 'neutral', topics: string[], summary: string }

// Streaming with type safety
const stream = await client.chat({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true,
});

for await (const chunk of stream) {
  // chunk is typed as string
  process.stdout.write(chunk);
}

const final = await stream.complete();
// final includes usage stats and finish reason

// Multi-modal with type safety
const visual = await client.chat({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', url: 'data:image/jpeg;base64,...' },
      ],
    },
  ],
});

// Tool calling with full type inference
const weatherTool: UnifiedTool = {
  name: 'get_weather',
  description: 'Get current weather',
  parameters: z.object({
    location: z.string(),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
};

const toolResponse = await client.chat({
  messages: [{ role: 'user', content: "What's the weather in Paris?" }],
  tools: [weatherTool],
});
```

This comprehensive type analysis should help you design a library with excellent TypeScript support that seamlessly integrates with existing patterns while providing type safety across all LLM providers.