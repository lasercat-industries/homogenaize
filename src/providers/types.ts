import type { ChatRequest, ChatResponse, Provider, ModelInfo } from './provider';
import type { OpenaiModel, AnthropicModel, GeminiModel } from '../generated/model-types';

// Re-export ModelInfo from provider
export type { ModelInfo };

// Provider names as const
export type ProviderName = 'openai' | 'anthropic' | 'gemini';

// Model types mapped to providers
export type ProviderModels = {
  openai: OpenaiModel;
  anthropic: AnthropicModel;
  gemini: GeminiModel;
};

// Provider-specific request types
export interface OpenAIChatRequest extends ChatRequest {
  features?: {
    logprobs?: boolean;
    topLogprobs?: number;
    seed?: number;
    responseFormat?: { type: 'json_object' | 'json_schema'; json_schema?: unknown };
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

// Union type for all provider requests
export type ProviderChatRequest<P extends ProviderName> = P extends 'openai'
  ? OpenAIChatRequest
  : P extends 'anthropic'
    ? AnthropicChatRequest
    : P extends 'gemini'
      ? GeminiChatRequest
      : never;

// Extended response type with provider-specific fields
export interface OpenAIChatResponse<T = string> extends ChatResponse<T> {
  logprobs?: Array<{
    token: string;
    logprob: number;
    topLogprobs?: Array<{ token: string; logprob: number }>;
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

// Union type for all provider responses
export type ProviderChatResponse<P extends ProviderName, T = string> = P extends 'openai'
  ? OpenAIChatResponse<T>
  : P extends 'anthropic'
    ? AnthropicChatResponse<T>
    : P extends 'gemini'
      ? GeminiChatResponse<T>
      : never;

// Provider with specific type
export interface TypedProvider<P extends ProviderName> extends Provider {
  readonly name: P;
  chat<T = string>(request: ProviderChatRequest<P>): Promise<ProviderChatResponse<P, T>>;
  stream<T = string>(
    request: ProviderChatRequest<P>,
  ): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ProviderChatResponse<P, T>>;
  }>;
}

// Type guards
export function isOpenAIResponse<T>(
  _response: ChatResponse<T>,
  provider: ProviderName,
): _response is OpenAIChatResponse<T> {
  return provider === 'openai';
}

export function isAnthropicResponse<T>(
  _response: ChatResponse<T>,
  provider: ProviderName,
): _response is AnthropicChatResponse<T> {
  return provider === 'anthropic';
}

export function isGeminiResponse<T>(
  _response: ChatResponse<T>,
  provider: ProviderName,
): _response is GeminiChatResponse<T> {
  return provider === 'gemini';
}
