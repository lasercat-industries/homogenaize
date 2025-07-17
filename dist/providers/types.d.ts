import type { ChatRequest, ChatResponse, Provider, ModelInfo } from './provider';
import type { OpenaiModel, AnthropicModel, GeminiModel } from '../generated/model-types';
export type { ModelInfo };
export type ProviderName = 'openai' | 'anthropic' | 'gemini';
export type ProviderModels = {
    openai: OpenaiModel;
    anthropic: AnthropicModel;
    gemini: GeminiModel;
};
export interface OpenAIChatRequest extends ChatRequest {
    features?: {
        logprobs?: boolean;
        topLogprobs?: number;
        seed?: number;
        responseFormat?: {
            type: 'json_object' | 'json_schema';
            json_schema?: unknown;
        };
    };
}
export interface AnthropicChatRequest extends ChatRequest {
    features?: {
        thinking?: boolean;
        cacheControl?: boolean;
        maxThinkingTokens?: number;
    };
}
export interface GeminiChatRequest extends ChatRequest {
    features?: {
        safetySettings?: Array<{
            category: string;
            threshold: string;
        }>;
        generationConfig?: {
            stopSequences?: string[];
            candidateCount?: number;
            maxOutputTokens?: number;
            temperature?: number;
        };
    };
}
export type ProviderChatRequest<P extends ProviderName> = P extends 'openai' ? OpenAIChatRequest : P extends 'anthropic' ? AnthropicChatRequest : P extends 'gemini' ? GeminiChatRequest : never;
export interface OpenAIChatResponse<T = string> extends ChatResponse<T> {
    logprobs?: Array<{
        token: string;
        logprob: number;
        topLogprobs?: Array<{
            token: string;
            logprob: number;
        }>;
    }>;
    systemFingerprint?: string;
}
export interface AnthropicChatResponse<T = string> extends ChatResponse<T> {
    thinking?: string;
    cacheInfo?: {
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
    };
    stopReason?: string;
}
export interface GeminiChatResponse<T = string> extends ChatResponse<T> {
    safetyRatings?: Array<{
        category: string;
        probability: string;
    }>;
    citationMetadata?: {
        citations: Array<{
            startIndex?: number;
            endIndex?: number;
            uri?: string;
            license?: string;
        }>;
    };
}
export type ProviderChatResponse<P extends ProviderName, T = string> = P extends 'openai' ? OpenAIChatResponse<T> : P extends 'anthropic' ? AnthropicChatResponse<T> : P extends 'gemini' ? GeminiChatResponse<T> : never;
export interface TypedProvider<P extends ProviderName> extends Provider {
    readonly name: P;
    chat<T = string>(request: ProviderChatRequest<P>): Promise<ProviderChatResponse<P, T>>;
    stream<T = string>(request: ProviderChatRequest<P>): Promise<{
        [Symbol.asyncIterator](): AsyncIterator<T>;
        complete(): Promise<ProviderChatResponse<P, T>>;
    }>;
}
export declare function isOpenAIResponse<T>(_response: ChatResponse<T>, provider: ProviderName): _response is OpenAIChatResponse<T>;
export declare function isAnthropicResponse<T>(_response: ChatResponse<T>, provider: ProviderName): _response is AnthropicChatResponse<T>;
export declare function isGeminiResponse<T>(_response: ChatResponse<T>, provider: ProviderName): _response is GeminiChatResponse<T>;
//# sourceMappingURL=types.d.ts.map