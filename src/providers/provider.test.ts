import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type {
  Provider,
  ChatRequest,
  ChatResponse,
  StreamingResponse,
  ProviderCapabilities,
} from './provider';

describe('Provider Interface', () => {
  describe('Type Definitions', () => {
    it('should define proper message types', () => {
      // Test that message types are properly defined
      const userMessage = {
        role: 'user' as const,
        content: 'Hello',
      };

      const assistantMessage = {
        role: 'assistant' as const,
        content: 'Hi there!',
      };

      const systemMessage = {
        role: 'system' as const,
        content: 'You are a helpful assistant',
      };

      // These should all be valid message types
      expect(userMessage.role).toBe('user');
      expect(assistantMessage.role).toBe('assistant');
      expect(systemMessage.role).toBe('system');
    });

    it('should support multi-modal content', () => {
      const multiModalMessage = {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'What is in this image?' },
          { type: 'image' as const, url: 'data:image/jpeg;base64,...' },
        ],
      };

      expect(multiModalMessage.content).toHaveLength(2);
      expect(multiModalMessage.content[0]?.type).toBe('text');
      expect(multiModalMessage.content[1]?.type).toBe('image');
    });
  });

  describe('Provider Capabilities', () => {
    it('should define provider capabilities', () => {
      const capabilities: ProviderCapabilities = {
        streaming: true,
        tools: true,
        structuredOutput: true,
        vision: false,
        maxTokens: 4096,
      };

      expect(capabilities.streaming).toBe(true);
      expect(capabilities.tools).toBe(true);
      expect(capabilities.structuredOutput).toBe(true);
      expect(capabilities.vision).toBe(false);
      expect(capabilities.maxTokens).toBe(4096);
    });
  });

  describe('Chat Request', () => {
    it('should accept basic chat request', () => {
      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      expect(request.messages).toHaveLength(1);
    });

    it('should accept chat request with options', () => {
      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        maxTokens: 1000,
        stream: false,
      };

      expect(request.temperature).toBe(0.7);
      expect(request.maxTokens).toBe(1000);
      expect(request.stream).toBe(false);
    });

    it('should accept structured output schema', () => {
      const schema = z.object({
        answer: z.string(),
        confidence: z.number(),
      });

      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        schema,
      };

      expect(request.schema).toBeDefined();
    });

    it('should accept tools in request', () => {
      const request: ChatRequest = {
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a location',
            parameters: z.object({
              location: z.string(),
            }),
          },
        ],
        toolChoice: 'required',
      };

      expect(request.tools).toHaveLength(1);
      expect(request.toolChoice).toBe('required');
    });
  });

  describe('Provider Mock Implementation', () => {
    // Mock provider for testing the interface
    class MockProvider implements Provider {
      name = 'mock' as const;

      capabilities: ProviderCapabilities = {
        streaming: true,
        tools: true,
        structuredOutput: true,
        vision: false,
        maxTokens: 4096,
      };

      async chat<T = string>(request: ChatRequest): Promise<ChatResponse<T>> {
        if (request.stream) {
          throw new Error('Use stream() method for streaming requests');
        }

        return {
          content: 'Mock response' as T,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
          model: 'mock-model',
          finishReason: 'stop',
        };
      }

      async stream<T = string>(_request: ChatRequest): Promise<StreamingResponse<T>> {
        const chunks = ['Mock', ' ', 'streaming', ' ', 'response'];
        let index = 0;

        return {
          async *[Symbol.asyncIterator](): AsyncIterator<T> {
            while (index < chunks.length) {
              yield chunks[index++] as T;
            }
          },

          async complete(): Promise<ChatResponse<T>> {
            return {
              content: chunks.join('') as T,
              usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
              },
              model: 'mock-model',
              finishReason: 'stop',
            };
          },
        };
      }

      supportsFeature(feature: string): boolean {
        return feature in this.capabilities;
      }

      async listModels() {
        return [
          { id: 'mock-model-1', name: 'Mock Model 1' },
          { id: 'mock-model-2', name: 'Mock Model 2' },
        ];
      }
    }

    it('should implement chat method', async () => {
      const provider = new MockProvider();
      const response = await provider.chat({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Mock response');
      expect(response.usage).toBeDefined();
      expect(response.usage.totalTokens).toBe(15);
    });

    it('should implement streaming', async () => {
      const provider = new MockProvider();
      const stream = await provider.stream({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Mock', ' ', 'streaming', ' ', 'response']);

      const complete = await stream.complete();
      expect(complete.content).toBe('Mock streaming response');
    });
  });
});
