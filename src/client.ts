import { z } from 'zod';
import type { 
  ProviderName, 
  ProviderChatRequest, 
  ProviderChatResponse,
  TypedProvider
} from './providers/types';
import type { Message, Tool, ToolCall } from './providers/provider';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';

// Client configuration
export interface LLMConfig<P extends ProviderName> {
  provider: P;
  apiKey: string;
  model: string;
  defaultOptions?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
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

// Main client interface
export interface LLMClient<P extends ProviderName> {
  readonly provider: P;
  readonly apiKey: string;
  readonly model: string;
  readonly defaultOptions?: LLMConfig<P>['defaultOptions'];

  // Core methods
  chat<T = string>(
    options: Omit<ProviderChatRequest<P>, 'model'> & { schema?: z.ZodSchema<T> }
  ): Promise<ProviderChatResponse<P, T>>;
  
  stream<T = string>(
    options: Omit<ProviderChatRequest<P>, 'model'> & { schema?: z.ZodSchema<T> }
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ProviderChatResponse<P, T>>;
  }>;

  // Tool methods
  defineTool<T extends z.ZodSchema>(config: ToolConfig<T>): ExecutableTool<T>;
  executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]>;
}

// Implementation class
export class LLMClientImpl<P extends ProviderName> implements LLMClient<P> {
  private tools = new Map<string, ExecutableTool>();

  constructor(
    public readonly provider: P,
    public readonly apiKey: string,
    public readonly model: string,
    public readonly defaultOptions?: LLMConfig<P>['defaultOptions'],
    private providerImpl?: TypedProvider<P>
  ) {}

  async chat<T = string>(
    options: Omit<ProviderChatRequest<P>, 'model'> & { schema?: z.ZodSchema<T> }
  ): Promise<ProviderChatResponse<P, T>> {
    if (!this.providerImpl) {
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }

    const request: ProviderChatRequest<P> = {
      ...options,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      model: this.model,
    } as ProviderChatRequest<P>;

    const response = await this.providerImpl.chat(request);
    
    // Validate response if schema provided
    if (options.schema && typeof response.content === 'string') {
      try {
        const parsed = JSON.parse(response.content);
        const validated = options.schema.parse(parsed);
        return { ...response, content: validated as T };
      } catch (error) {
        throw new Error(`Response validation failed: ${error}`);
      }
    }

    return response as ProviderChatResponse<P, T>;
  }

  async stream<T = string>(
    options: Omit<ProviderChatRequest<P>, 'model'> & { schema?: z.ZodSchema<T> }
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ProviderChatResponse<P, T>>;
  }> {
    if (!this.providerImpl) {
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }

    const request: ProviderChatRequest<P> = {
      ...options,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      model: this.model,
    } as ProviderChatRequest<P>;

    return this.providerImpl.stream(request);
  }

  defineTool<T extends z.ZodSchema>(config: ToolConfig<T>): ExecutableTool<T> {
    const tool: ExecutableTool<T> = {
      name: config.name,
      description: config.description,
      parameters: config.schema,
      execute: config.execute
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
          error: `Tool ${call.name} not found`
        });
        continue;
      }

      try {
        const params = tool.parameters.parse(call.arguments);
        const result = await tool.execute(params);
        results.push({
          toolCallId: call.id,
          result
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          result: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return results;
  }
}

// Factory functions
export function createLLM<P extends ProviderName>(
  config: LLMConfig<P>
): LLMClient<P> {
  let providerImpl: TypedProvider<P> | undefined;
  
  // Create provider implementation based on provider name
  switch (config.provider) {
    case 'openai':
      providerImpl = new OpenAIProvider(config.apiKey) as TypedProvider<P>;
      break;
    case 'anthropic':
      providerImpl = new AnthropicProvider(config.apiKey) as TypedProvider<P>;
      break;
    case 'gemini':
      providerImpl = new GeminiProvider(config.apiKey) as TypedProvider<P>;
      break;
  }
  
  return new LLMClientImpl(
    config.provider,
    config.apiKey,
    config.model,
    config.defaultOptions,
    providerImpl
  );
}

export function createOpenAILLM(
  config: Omit<LLMConfig<'openai'>, 'provider'>
): LLMClient<'openai'> {
  return createLLM({ ...config, provider: 'openai' });
}

export function createAnthropicLLM(
  config: Omit<LLMConfig<'anthropic'>, 'provider'>
): LLMClient<'anthropic'> {
  return createLLM({ ...config, provider: 'anthropic' });
}

export function createGeminiLLM(
  config: Omit<LLMConfig<'gemini'>, 'provider'>
): LLMClient<'gemini'> {
  return createLLM({ ...config, provider: 'gemini' });
}