import type { ChatRequest, ChatResponse, Provider, ModelInfo } from './provider';
import type { OpenaiModel, AnthropicModel, GeminiModel } from '../generated/model-types';
export type { ModelInfo };
export type ProviderName = 'openai' | 'anthropic' | 'gemini';
export type ProviderModels = {
    openai: OpenaiModel;
    anthropic: AnthropicModel;
    gemini: GeminiModel;
};
export interface ProviderFeatures {
    openai: {
        logprobs?: boolean;
        topLogprobs?: number;
        seed?: number;
        responseFormat?: {
            type: 'json_object' | 'json_schema';
            json_schema?: unknown;
        };
    };
    anthropic: {
        thinking?: boolean;
        cacheControl?: boolean;
        maxThinkingTokens?: number;
    };
    gemini: {
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
export interface ProviderResponses {
    openai: {
        logprobs?: Array<{
            token: string;
            logprob: number;
            topLogprobs?: Array<{
                token: string;
                logprob: number;
            }>;
        }>;
        systemFingerprint?: string;
    };
    anthropic: {
        thinking?: string;
        cacheInfo?: {
            cacheCreationInputTokens?: number;
            cacheReadInputTokens?: number;
        };
        stopReason?: string;
    };
    gemini: {
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
    };
}
export interface ProviderChatRequest<P extends ProviderName> extends ChatRequest {
    features?: ProviderFeatures[P];
}
export type ProviderChatResponse<P extends ProviderName, T = string> = ChatResponse<T> & ProviderResponses[P];
export interface TypedProvider<P extends ProviderName> extends Provider {
    readonly name: P;
    chat<T = string>(request: ProviderChatRequest<P>): Promise<ProviderChatResponse<P, T>>;
    stream<T = string>(request: ProviderChatRequest<P>): Promise<{
        [Symbol.asyncIterator](): AsyncIterator<T>;
        complete(): Promise<ProviderChatResponse<P, T>>;
    }>;
}
export declare function isOpenAIResponse<T>(_response: ChatResponse<T>, provider: ProviderName): _response is ProviderChatResponse<'openai', T>;
export declare function isAnthropicResponse<T>(_response: ChatResponse<T>, provider: ProviderName): _response is ProviderChatResponse<'anthropic', T>;
export declare function isGeminiResponse<T>(_response: ChatResponse<T>, provider: ProviderName): _response is ProviderChatResponse<'gemini', T>;
//# sourceMappingURL=types.d.ts.map