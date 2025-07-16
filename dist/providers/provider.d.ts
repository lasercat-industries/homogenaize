import { z } from 'zod';
export interface ModelInfo {
    id: string;
    name: string;
    description?: string;
    created?: number;
    capabilities?: {
        chat?: boolean;
        completions?: boolean;
        embeddings?: boolean;
        fineTuning?: boolean;
        vision?: boolean;
        functionCalling?: boolean;
    };
    contextWindow?: number;
    maxOutputTokens?: number;
}
export type MessageRole = 'user' | 'assistant' | 'system';
export type TextContent = string;
export interface MultiModalContent {
    type: 'text' | 'image';
    text?: string;
    url?: string;
    mimeType?: string;
}
export interface Message {
    role: MessageRole;
    content: TextContent | MultiModalContent[];
}
export interface Tool {
    name: string;
    description: string;
    parameters: z.ZodSchema;
}
export interface ToolCall {
    id: string;
    name: string;
    arguments: unknown;
}
export interface ChatRequest {
    messages: Message[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    schema?: z.ZodSchema;
    tools?: Tool[];
    toolChoice?: 'auto' | 'required' | 'none' | {
        name: string;
    };
}
export interface Usage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}
export interface ChatResponse<T = string> {
    content: T;
    usage: Usage;
    model: string;
    finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    toolCalls?: ToolCall[];
}
export interface StreamingResponse<T = string> {
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ChatResponse<T>>;
}
export interface ProviderCapabilities {
    streaming: boolean;
    tools: boolean;
    structuredOutput: boolean;
    vision: boolean;
    maxTokens: number;
}
export interface Provider {
    readonly name: string;
    readonly capabilities: ProviderCapabilities;
    chat<T = string>(request: ChatRequest): Promise<ChatResponse<T>>;
    stream<T = string>(request: ChatRequest): Promise<StreamingResponse<T>>;
    supportsFeature(feature: string): boolean;
    listModels(): Promise<ModelInfo[]>;
}
//# sourceMappingURL=provider.d.ts.map