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
}

// Tool definition configuration
export interface ToolConfig<T extends z.ZodSchema> {
  name: string;
  description: string;
  schema: T;
  execute: (params: z.infer<T>) => Promise<any>;
}

// Tool with execution capability
export interface ExecutableTool<T extends z.ZodSchema = z.ZodSchema> extends Tool {
  execute: (params: z.infer<T>) => Promise<any>;
}

// Tool execution result
export interface ToolResult {
  toolCallId: string;
  result: any;
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
}

// Implementation class
export class LLMClientImpl<P extends ProviderName> implements LLMClient<P> {
  private tools = new Map<string, ExecutableTool>();

  constructor(
    public readonly provider: P,
    public readonly apiKey: string,
    public readonly model: ProviderModels[P],
    public readonly defaultOptions?: LLMConfig<P>['defaultOptions'],
    public readonly retry?: RetryConfig,
    private providerImpl?: TypedProvider<P>,
  ) {}

  async chat<T = string>(options: ChatOptions<P, T>): Promise<ProviderChatResponse<P, T>> {
    if (!this.providerImpl) {
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }

    const request: ProviderChatRequest<P> = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: options.stream,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model,
    } as ProviderChatRequest<P>;

    const response = await this.providerImpl.chat<T>(request);

    return response;
  }

  async stream<T = string>(
    options: StreamOptions<P, T>,
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ProviderChatResponse<P, T>>;
  }> {
    if (!this.providerImpl) {
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }

    const request: ProviderChatRequest<P> = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: true,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model,
    } as ProviderChatRequest<P>;

    return this.providerImpl.stream(request);
  }

  defineTool<T extends z.ZodSchema>(config: ToolConfig<T>): ExecutableTool<T> {
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
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const tool = this.tools.get(call.name);
      if (!tool) {
        results.push({
          toolCallId: call.id,
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
          result,
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
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
}

// Factory functions
export function createLLM<P extends ProviderName>(config: LLMConfig<P>): LLMClient<P> {
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
