import { describe, it, expect } from 'vitest';
import type { ProviderChatRequest, ProviderChatResponse, TypedProvider } from './types';
import type { ChatResponse } from './provider';
import { isOpenAIResponse, isAnthropicResponse } from './types';

describe('Provider Types', () => {
  describe('Provider-specific features', () => {
    it('should type OpenAI features correctly', () => {
      const openAIRequest: ProviderChatRequest<'openai'> = {
        messages: [{ role: 'user', content: 'Hello' }],
        features: {
          logprobs: true,
          topLogprobs: 5,
          seed: 12345,
        },
      };

      expect(openAIRequest.features?.logprobs).toBe(true);
      expect(openAIRequest.features?.topLogprobs).toBe(5);

      // @ts-expect-error - thinking is not an OpenAI feature
      openAIRequest.features.thinking = true;
    });

    it('should type Anthropic features correctly', () => {
      const anthropicRequest: ProviderChatRequest<'anthropic'> = {
        messages: [{ role: 'user', content: 'Hello' }],
        features: {
          thinking: true,
          maxThinkingTokens: 1000,
          cacheControl: true,
        },
      };

      expect(anthropicRequest.features?.thinking).toBe(true);
      expect(anthropicRequest.features?.maxThinkingTokens).toBe(1000);

      // @ts-expect-error - logprobs is not an Anthropic feature
      anthropicRequest.features.logprobs = true;
    });

    it('should type Gemini features correctly', () => {
      const geminiRequest: ProviderChatRequest<'gemini'> = {
        messages: [{ role: 'user', content: 'Hello' }],
        features: {
          safetySettings: [
            { category: 'HARM_CATEGORY_DANGEROUS', threshold: 'BLOCK_LOW_AND_ABOVE' },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        },
      };

      expect(geminiRequest.features?.safetySettings).toHaveLength(1);
      expect(geminiRequest.features?.generationConfig?.temperature).toBe(0.7);

      // @ts-expect-error - thinking is not a Gemini feature
      geminiRequest.features.thinking = true;
    });
  });

  describe('Provider-specific responses', () => {
    it('should type OpenAI responses correctly', () => {
      const openAIResponse: ProviderChatResponse<'openai'> = {
        content: 'Hello!',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: 'gpt-4',
        logprobs: [{ token: 'Hello', logprob: -0.5 }],
        systemFingerprint: 'fp_12345',
      };

      expect(openAIResponse.logprobs).toBeDefined();
      expect(openAIResponse.systemFingerprint).toBe('fp_12345');

      // @ts-expect-error - thinking is not an OpenAI response field
      openAIResponse.thinking = 'some thoughts';
    });

    it('should type Anthropic responses correctly', () => {
      const anthropicResponse: ProviderChatResponse<'anthropic'> = {
        content: 'Hello!',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        model: 'claude-3',
        thinking: 'Let me think about this...',
        cacheInfo: {
          cacheCreationInputTokens: 100,
          cacheReadInputTokens: 50,
        },
      };

      expect(anthropicResponse.thinking).toBe('Let me think about this...');
      expect(anthropicResponse.cacheInfo?.cacheCreationInputTokens).toBe(100);

      // @ts-expect-error - logprobs is not an Anthropic response field
      anthropicResponse.logprobs = [];
    });
  });

  describe('Type guards', () => {
    const baseResponse: ChatResponse = {
      content: 'Hello',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      model: 'test-model',
    };

    it('should correctly identify OpenAI responses', () => {
      const response = { ...baseResponse };

      if (isOpenAIResponse(response, 'openai')) {
        // TypeScript should know this is an OpenAI response
        // The type guard works at compile time
        expect(true).toBe(true); // Type guard worked
      } else {
        expect(false).toBe(true); // Should not reach here
      }

      expect(isOpenAIResponse(response, 'anthropic')).toBe(false);
      expect(isOpenAIResponse(response, 'gemini')).toBe(false);
    });

    it('should correctly identify Anthropic responses', () => {
      const response = { ...baseResponse };

      if (isAnthropicResponse(response, 'anthropic')) {
        // TypeScript should know this is an Anthropic response
        // The type guard works at compile time
        expect(true).toBe(true); // Type guard worked
      } else {
        expect(false).toBe(true); // Should not reach here
      }

      expect(isAnthropicResponse(response, 'openai')).toBe(false);
      expect(isAnthropicResponse(response, 'gemini')).toBe(false);
    });
  });

  describe('TypedProvider interface', () => {
    it('should enforce provider-specific types', () => {
      // Mock OpenAI provider
      const openAIProvider: TypedProvider<'openai'> = {
        name: 'openai',
        capabilities: {
          streaming: true,
          tools: true,
          structuredOutput: true,
          vision: true,
          maxTokens: 128000,
        },
        async chat<T = string>(request: any) {
          // Request should have OpenAI-specific features
          if (request.features?.logprobs) {
            return {
              content: 'Response' as T,
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              model: 'gpt-4',
              logprobs: [{ token: 'Response', logprob: -0.1 }],
            };
          }
          return {
            content: 'Response' as T,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            model: 'gpt-4',
          };
        },
        async stream() {
          throw new Error('Not implemented in test');
        },
        supportsFeature(feature: string) {
          return feature in this.capabilities;
        },
      };

      expect(openAIProvider.name).toBe('openai');
      expect(openAIProvider.capabilities.vision).toBe(true);
    });
  });
});
