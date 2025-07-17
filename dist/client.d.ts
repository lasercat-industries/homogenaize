import { z } from 'zod';
import type { ProviderName, ProviderChatResponse, TypedProvider, ModelInfo, ProviderModels, OpenAIChatRequest, AnthropicChatRequest, GeminiChatRequest } from './providers/types';
import type { Message, Tool, ToolCall } from './providers/provider';
import type { RetryConfig } from './retry/types';
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
export interface ToolConfig<T extends z.ZodSchema> {
    name: string;
    description: string;
    schema: T;
    execute: (params: z.infer<T>) => Promise<any>;
}
export interface ExecutableTool<T extends z.ZodSchema = z.ZodSchema> extends Tool {
    execute: (params: z.infer<T>) => Promise<any>;
}
export interface ToolResult {
    toolCallId: string;
    result: any;
    error?: string;
}
export interface BaseChatOptions<T = string> {
    messages: Message[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    schema?: z.ZodSchema<T>;
    tools?: Tool[];
    toolChoice?: 'auto' | 'required' | 'none' | {
        name: string;
    };
}
export type ChatOptions<P extends ProviderName = ProviderName, T = string> = BaseChatOptions<T> & {
    features?: P extends 'openai' ? OpenAIChatRequest['features'] : P extends 'anthropic' ? AnthropicChatRequest['features'] : P extends 'gemini' ? GeminiChatRequest['features'] : never;
};
export type StreamOptions<P extends ProviderName = ProviderName, T = string> = ChatOptions<P, T>;
export type DefineToolOptions<T extends z.ZodSchema = z.ZodSchema> = ToolConfig<T>;
export type ExecuteToolsOptions = ToolCall[];
export interface LLMClient<P extends ProviderName> {
    readonly provider: P;
    readonly apiKey: string;
    readonly model: ProviderModels[P];
    readonly defaultOptions?: LLMConfig<P>['defaultOptions'];
    readonly retry?: RetryConfig;
    chat<T = string>(options: ChatOptions<P, T>): Promise<ProviderChatResponse<P, T>>;
    stream<T = string>(options: StreamOptions<P, T>): Promise<{
        [Symbol.asyncIterator](): AsyncIterator<T>;
        complete(): Promise<ProviderChatResponse<P, T>>;
    }>;
    defineTool<T extends z.ZodSchema>(config: DefineToolOptions<T>): ExecutableTool<T>;
    executeTools(toolCalls: ExecuteToolsOptions): Promise<ToolResult[]>;
    listModels(): Promise<ModelInfo[]>;
}
export declare class LLMClientImpl<P extends ProviderName> implements LLMClient<P> {
    readonly provider: P;
    readonly apiKey: string;
    readonly model: ProviderModels[P];
    readonly defaultOptions?: LLMConfig<P>['defaultOptions'];
    readonly retry?: RetryConfig | undefined;
    private providerImpl?;
    private tools;
    constructor(provider: P, apiKey: string, model: ProviderModels[P], defaultOptions?: LLMConfig<P>['defaultOptions'], retry?: RetryConfig | undefined, providerImpl?: TypedProvider<P> | undefined);
    chat<T = string>(options: ChatOptions<P, T>): Promise<ProviderChatResponse<P, T>>;
    stream<T = string>(options: StreamOptions<P, T>): Promise<{
        [Symbol.asyncIterator](): AsyncIterator<T>;
        complete(): Promise<ProviderChatResponse<P, T>>;
    }>;
    defineTool<T extends z.ZodSchema>(config: ToolConfig<T>): ExecutableTool<T>;
    executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]>;
    listModels(): Promise<ModelInfo[]>;
}
export declare function createLLM<P extends ProviderName>(config: LLMConfig<P>): LLMClient<P>;
export declare function createOpenAILLM(config: Omit<LLMConfig<'openai'>, 'provider'>): LLMClient<'openai'>;
export declare function createAnthropicLLM(config: Omit<LLMConfig<'anthropic'>, 'provider'>): LLMClient<'anthropic'>;
export declare function createGeminiLLM(config: Omit<LLMConfig<'gemini'>, 'provider'>): LLMClient<'gemini'>;
//# sourceMappingURL=client.d.ts.map