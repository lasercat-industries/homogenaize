import { z } from 'zod';
import type {
  ProviderName,
  ProviderChatRequest,
  ProviderChatResponse,
  TypedProvider,
  ModelInfo,
  ProviderModels,
  OpenAIChatRequest,
  AnthropicChatRequest,
  GeminiChatRequest,
} from './providers/types';
import type { Message, Tool, ToolCall } from './providers/provider';
import type { RetryConfig } from './retry/types';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { getLogger, configureLogger, type LoggerConfig } from './utils/logger';

// Client configuration
export interface LLMConfig<P extends ProviderName> {
  provider: P;
  apiKey: string;
  model: ProviderModels[P];
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

// Tool definition configuration
export interface ToolConfig<T extends z.ZodSchema> {
  name: string;
  description: string;
  schema: T;
  execute: (params: z.infer<T>) => Promise<unknown>;
}

// Tool with execution capability
export interface ExecutableTool<T extends z.ZodSchema = z.ZodSchema> extends Tool {
  execute: (params: z.infer<T>) => Promise<unknown>;
}

// Tool execution result
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error?: string;
}

// Base chat options without provider-specific features
export interface BaseChatOptions<T = string> {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  schema?: z.ZodSchema<T>;
  tools?: Tool[];
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };
  retry?: RetryConfig;
  signal?: AbortSignal;
}

// Provider-specific chat options
export type ChatOptions<P extends ProviderName = ProviderName, T = string> = BaseChatOptions<T> & {
  features?: P extends 'openai'
    ? OpenAIChatRequest['features']
    : P extends 'anthropic'
      ? AnthropicChatRequest['features']
      : P extends 'gemini'
        ? GeminiChatRequest['features']
        : never;
};

export type StreamOptions<P extends ProviderName = ProviderName, T = string> = ChatOptions<P, T>;

export type DefineToolOptions<T extends z.ZodSchema = z.ZodSchema> = ToolConfig<T>;

export type ExecuteToolsOptions = ToolCall[];

// Main client interface
export interface LLMClient<P extends ProviderName> {
  readonly provider: P;
  readonly apiKey: string;
  readonly model: ProviderModels[P];
  readonly defaultOptions?: LLMConfig<P>['defaultOptions'];
  readonly retry?: RetryConfig;

  // Core methods
  chat<T = string>(options: ChatOptions<P, T>): Promise<ProviderChatResponse<P, T>>;

  stream<T = string>(
    options: StreamOptions<P, T>,
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ProviderChatResponse<P, T>>;
  }>;

  // Tool methods
  defineTool<T extends z.ZodSchema>(config: DefineToolOptions<T>): ExecutableTool<T>;
  executeTools(toolCalls: ExecuteToolsOptions): Promise<ToolResult[]>;

  // Model methods
  listModels(): Promise<ModelInfo[]>;

  // Retry configuration methods
  setRetryConfig(retry: RetryConfig | undefined): void;
  getRetryConfig(): RetryConfig | undefined;
}

// Implementation class
export class LLMClientImpl<P extends ProviderName> implements LLMClient<P> {
  private tools = new Map<string, ExecutableTool>();
  private retryConfig?: RetryConfig;

  constructor(
    public readonly provider: P,
    public readonly apiKey: string,
    public readonly model: ProviderModels[P],
    public readonly defaultOptions?: LLMConfig<P>['defaultOptions'],
    retry?: RetryConfig,
    private providerImpl?: TypedProvider<P>,
  ) {
    this.retryConfig = retry;
  }

  get retry(): RetryConfig | undefined {
    return this.retryConfig;
  }

  async chat<T = string>(options: ChatOptions<P, T>): Promise<ProviderChatResponse<P, T>> {
    const logger = getLogger('client');
    logger.debug('Chat request initiated', {
      provider: this.provider,
      model: this.model,
      hasSchema: !!options.schema,
      hasTools: !!options.tools,
    });

    if (!this.providerImpl) {
      logger.error(`Provider ${this.provider} not implemented yet`);
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }

    const request: ProviderChatRequest<P, T> = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: options.stream,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model,
      signal: options.signal,
    } as ProviderChatRequest<P, T>;

    // Use override retry config if provided, otherwise use client's default
    const retryConfig = options.retry ?? this.retryConfig;

    const response = await this.providerImpl.chat<T>(request, retryConfig);

    return response;
  }

  async stream<T = string>(
    options: StreamOptions<P, T>,
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ProviderChatResponse<P, T>>;
  }> {
    const logger = getLogger('client');
    logger.debug('Stream request initiated', {
      provider: this.provider,
      model: this.model,
      hasSchema: !!options.schema,
    });

    if (!this.providerImpl) {
      logger.error(`Provider ${this.provider} not implemented yet`);
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }

    const request: ProviderChatRequest<P, T> = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: true,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model,
      signal: options.signal,
    } as ProviderChatRequest<P, T>;

    // Use override retry config if provided, otherwise use client's default
    const retryConfig = options.retry ?? this.retryConfig;

    return this.providerImpl.stream<T>(request, retryConfig);
  }

  defineTool<T extends z.ZodSchema>(config: ToolConfig<T>): ExecutableTool<T> {
    const logger = getLogger('client');
    logger.debug('Defining tool', { name: config.name });

    const tool: ExecutableTool<T> = {
      name: config.name,
      description: config.description,
      parameters: config.schema,
      execute: config.execute,
    };

    this.tools.set(config.name, tool);
    return tool;
  }

  async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const logger = getLogger('client');
    logger.info('Executing tool calls', { count: toolCalls.length });

    const results: ToolResult[] = [];

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
    if (!this.providerImpl) {
      throw new Error('Provider not initialized');
    }
    return this.providerImpl.listModels();
  }

  setRetryConfig(retry: RetryConfig | undefined): void {
    const logger = getLogger('client');
    logger.debug('Updating client retry configuration', { hasConfig: !!retry });
    this.retryConfig = retry;
  }

  getRetryConfig(): RetryConfig | undefined {
    return this.retryConfig;
  }
}

// Factory functions
export function createLLM<P extends ProviderName>(config: LLMConfig<P>): LLMClient<P> {
  // Configure logging if specified
  if (config.logging !== undefined) {
    configureLogger(config.logging);
  }

  const logger = getLogger('client');
  logger.info('Creating LLM client', {
    provider: config.provider,
    model: config.model,
  });

  let providerImpl: TypedProvider<P> | undefined;

  // Create provider implementation based on provider name
  switch (config.provider) {
    case 'openai':
      providerImpl = new OpenAIProvider(
        config.apiKey,
        undefined,
        config.retry,
      ) as unknown as TypedProvider<P>;
      break;
    case 'anthropic':
      providerImpl = new AnthropicProvider(
        config.apiKey,
        undefined,
        config.retry,
      ) as unknown as TypedProvider<P>;
      break;
    case 'gemini':
      providerImpl = new GeminiProvider(
        config.apiKey,
        undefined,
        config.retry,
      ) as unknown as TypedProvider<P>;
      break;
  }

  return new LLMClientImpl(
    config.provider,
    config.apiKey,
    config.model,
    config.defaultOptions,
    config.retry,
    providerImpl,
  );
}

export function createOpenAILLM(
  config: Omit<LLMConfig<'openai'>, 'provider'>,
): LLMClient<'openai'> {
  return createLLM({ ...config, provider: 'openai' });
}

export function createAnthropicLLM(
  config: Omit<LLMConfig<'anthropic'>, 'provider'>,
): LLMClient<'anthropic'> {
  return createLLM({ ...config, provider: 'anthropic' });
}

export function createGeminiLLM(
  config: Omit<LLMConfig<'gemini'>, 'provider'>,
): LLMClient<'gemini'> {
  return createLLM({ ...config, provider: 'gemini' });
}
