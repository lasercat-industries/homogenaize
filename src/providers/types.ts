import { z } from 'zod';
import type { ChatRequest, ChatResponse, Provider } from './provider';

// Provider names as const
export type ProviderName = 'openai' | 'anthropic' | 'gemini';

// Provider-specific features
export interface ProviderFeatures {
  openai: {
    logprobs?: boolean;
    topLogprobs?: number;
    seed?: number;
    responseFormat?: { type: 'json_object' | 'json_schema'; json_schema?: unknown };
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

// Provider-specific responses
export interface ProviderResponses {
  openai: {
    logprobs?: Array<{
      token: string;
      logprob: number;
      topLogprobs?: Array<{ token: string; logprob: number }>;
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

// Extended request type with provider features
export interface ProviderChatRequest<P extends ProviderName> extends ChatRequest {
  features?: ProviderFeatures[P];
}

// Extended response type with provider-specific fields
export type ProviderChatResponse<P extends ProviderName, T = string> = 
  ChatResponse<T> & ProviderResponses[P];

// Provider with specific type
export interface TypedProvider<P extends ProviderName> extends Provider {
  readonly name: P;
  chat<T = string>(request: ProviderChatRequest<P>): Promise<ProviderChatResponse<P, T>>;
  stream<T = string>(request: ProviderChatRequest<P>): Promise<{
    [Symbol.asyncIterator](): AsyncIterator<T>;
    complete(): Promise<ProviderChatResponse<P, T>>;
  }>;
}

// Type guards
export function isOpenAIResponse<T>(
  response: ChatResponse<T>,
  provider: ProviderName
): response is ProviderChatResponse<'openai', T> {
  return provider === 'openai';
}

export function isAnthropicResponse<T>(
  response: ChatResponse<T>,
  provider: ProviderName
): response is ProviderChatResponse<'anthropic', T> {
  return provider === 'anthropic';
}

export function isGeminiResponse<T>(
  response: ChatResponse<T>,
  provider: ProviderName
): response is ProviderChatResponse<'gemini', T> {
  return provider === 'gemini';
}