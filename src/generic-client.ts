import { z } from 'zod';
import type { Message, Tool, ToolCall, ModelInfo } from './providers/provider';
import type { RetryConfig } from './retry/types';
import type { TypedProvider, ProviderName, ProviderChatRequest } from './providers/types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { getLogger, configureLogger, type LoggerConfig } from './utils/logger';

// Generic client configuration without provider type parameter
export interface GenericLLMConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  apiKey: string;
  model: string; // Accept any string instead of typed models
  defaultOptions?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  retry?: RetryConfig;
  logging?: LoggerConfig | boolean;
}

// Tool definition configuration (same as type-safe API)
export interface GenericToolConfig<T extends z.ZodSchema> {
  name: string;
  description: string;
  schema: T;
  execute: (params: z.infer<T>) => Promise<unknown>;
}

// Tool with execution capability (same as type-safe API)
export interface GenericExecutableTool<T extends z.ZodSchema = z.ZodSchema> extends Tool {
  execute: (params: z.infer<T>) => Promise<unknown>;
}

// Tool execution result (same as type-safe API)
export interface GenericToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error?: string;
}

// Generic chat options without provider-specific typing
export interface GenericChatOptions<T = string> {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  schema?: z.ZodSchema<T>;
  tools?: Tool[];
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };
  features?: Record<string, unknown>; // Accept any features without compile-time validation
}

export type GenericStreamOptions<T = string> = GenericChatOptions<T>;

export type GenericDefineToolOptions<T extends z.ZodSchema = z.ZodSchema> = GenericToolConfig<T>;

export type GenericExecuteToolsOptions = ToolCall[];

// Generic response type - use a union of all possible response fields
export interface GenericChatResponse<T = string> {
  content: T;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  toolCalls?: ToolCall[];
  // Provider-specific fields (available at runtime but not typed)
  logprobs?: unknown;
  systemFingerprint?: string;
  thinking?: string;
  cacheInfo?: unknown;
  stopReason?: string;
  safetyRatings?: unknown[];
  citationMetadata?: unknown;
}

// Generic client interface without provider type parameter
export interface GenericLLMClient {
  readonly provider: string;
  readonly apiKey: string;
  readonly model: string;
  readonly defaultOptions?: GenericLLMConfig['defaultOptions'];
  readonly retry?: RetryConfig;

  // Core methods
  chat<T = string>(options: GenericChatOptions<T>): Promise<GenericChatResponse<T>>;

  stream<T = string>(
    options: GenericStreamOptions<T>,
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<GenericChatResponse<T>>;
  }>;

  // Tool methods
  defineTool<T extends z.ZodSchema>(config: GenericDefineToolOptions<T>): GenericExecutableTool<T>;
  executeTools(toolCalls: GenericExecuteToolsOptions): Promise<GenericToolResult[]>;

  // Model methods
  listModels(): Promise<ModelInfo[]>;
}

// Generic implementation class
export class GenericLLMClientImpl implements GenericLLMClient {
  private tools = new Map<string, GenericExecutableTool>();
  private providerImpl: TypedProvider<ProviderName> | undefined;

  constructor(
    public readonly provider: string,
    public readonly apiKey: string,
    public readonly model: string,
    public readonly defaultOptions?: GenericLLMConfig['defaultOptions'],
    public readonly retry?: RetryConfig,
  ) {
    // Provider will be created lazily on first use
  }

  private getProvider(): TypedProvider<ProviderName> {
    if (!this.providerImpl) {
      // Create provider implementation based on provider name
      switch (this.provider) {
        case 'openai':
          this.providerImpl = new OpenAIProvider(this.apiKey, undefined, this.retry);
          break;
        case 'anthropic':
          this.providerImpl = new AnthropicProvider(this.apiKey, undefined, this.retry);
          break;
        case 'gemini':
          this.providerImpl = new GeminiProvider(this.apiKey, undefined, this.retry);
          break;
        default:
          throw new Error(`Unsupported provider: ${this.provider}`);
      }
    }
    return this.providerImpl;
  }

  async chat<T = string>(options: GenericChatOptions<T>): Promise<GenericChatResponse<T>> {
    const logger = getLogger('generic-client');
    logger.debug('Generic chat request initiated', {
      provider: this.provider,
      model: this.model,
      hasSchema: !!options.schema,
      hasTools: !!options.tools,
    });

    const provider = this.getProvider();

    // Create request object compatible with any provider
    const request: Record<string, unknown> = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: options.stream,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model,
    };

    const response = await provider.chat(
      request as unknown as ProviderChatRequest<ProviderName, T>,
    );

    // Return response as generic type
    return response as GenericChatResponse<T>;
  }

  async stream<T = string>(
    options: GenericStreamOptions<T>,
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<GenericChatResponse<T>>;
  }> {
    const logger = getLogger('generic-client');
    logger.debug('Generic stream request initiated', {
      provider: this.provider,
      model: this.model,
      hasSchema: !!options.schema,
    });

    const provider = this.getProvider();

    const request: Record<string, unknown> = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: true,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model,
    };

    const streamResponse = await provider.stream(
      request as unknown as ProviderChatRequest<ProviderName, T>,
    );

    // Return with generic complete method
    return {
      [Symbol.asyncIterator]: streamResponse[Symbol.asyncIterator].bind(streamResponse),
      complete: async () => {
        const result = await streamResponse.complete();
        return result as GenericChatResponse<T>;
      },
    };
  }

  defineTool<T extends z.ZodSchema>(config: GenericToolConfig<T>): GenericExecutableTool<T> {
    const logger = getLogger('generic-client');
    logger.debug('Defining tool', { name: config.name });

    const tool: GenericExecutableTool<T> = {
      name: config.name,
      description: config.description,
      parameters: config.schema,
      execute: config.execute,
    };

    this.tools.set(config.name, tool);
    return tool;
  }

  async executeTools(toolCalls: ToolCall[]): Promise<GenericToolResult[]> {
    const logger = getLogger('generic-client');
    logger.info('Executing tool calls', { count: toolCalls.length });

    const results: GenericToolResult[] = [];

    for (const call of toolCalls) {
      const tool = this.tools.get(call.name);
      if (!tool) {
        logger.warn(`Tool ${call.name} not found`);
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          result: null,
          error: `Tool ${call.name} not found`,
        });
        continue;
      }

      try {
        const params = tool.parameters.parse(call.arguments);
        const result = await tool.execute(params);
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          result,
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  async listModels(): Promise<ModelInfo[]> {
    const provider = this.getProvider();
    return provider.listModels();
  }
}

// Generic factory function
export function createGenericLLM(config: GenericLLMConfig): GenericLLMClient {
  // Configure logging if specified
  if (config.logging !== undefined) {
    configureLogger(config.logging);
  }

  const logger = getLogger('generic-client');
  logger.info('Creating generic LLM client', { provider: config.provider, model: config.model });

  return new GenericLLMClientImpl(
    config.provider,
    config.apiKey,
    config.model,
    config.defaultOptions,
    config.retry,
  );
}

// Provider-specific generic factories
export function createGenericOpenAI(config: Omit<GenericLLMConfig, 'provider'>): GenericLLMClient {
  return createGenericLLM({ ...config, provider: 'openai' });
}

export function createGenericAnthropic(
  config: Omit<GenericLLMConfig, 'provider'>,
): GenericLLMClient {
  return createGenericLLM({ ...config, provider: 'anthropic' });
}

export function createGenericGemini(config: Omit<GenericLLMConfig, 'provider'>): GenericLLMClient {
  return createGenericLLM({ ...config, provider: 'gemini' });
}
