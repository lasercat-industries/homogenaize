import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { OpenAIProvider } from './openai';
import type { OpenAIChatRequest, OpenAIChatResponse } from '../types';

describe('OpenAI Reasoning Effort', () => {
  let provider: OpenAIProvider;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = mock() as any;
    provider = new OpenAIProvider('test-key');
  });

  afterEach(() => {
    mock.restore();
    global.fetch = originalFetch;
  });

  describe('Request Transformation', () => {
    it('should include reasoning_effort in request when reasoningEffort is specified', async () => {
      const request: OpenAIChatRequest = {
        messages: [{ role: 'user', content: 'Test message' }],
        model: 'gpt-4',
        features: {
          reasoningEffort: 'medium',
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'Response' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
          model: 'gpt-4',
        }),
      });

      await provider.chat(request);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          body: expect.stringContaining('"reasoning_effort":"medium"'),
        }),
      );
    });

    it('should support all reasoning effort levels', async () => {
      const levels: Array<'minimal' | 'low' | 'medium' | 'high'> = [
        'minimal',
        'low',
        'medium',
        'high',
      ];

      for (const level of levels) {
        const request: OpenAIChatRequest = {
          messages: [{ role: 'user', content: 'Test' }],
          features: {
            reasoningEffort: level,
          },
        };

        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: { content: 'Response' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
            model: 'gpt-4',
          }),
        });

        await provider.chat(request);

        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining(`"reasoning_effort":"${level}"`),
          }),
        );
      }
    });

    it('should not include reasoning_effort when reasoningEffort is not specified', async () => {
      const request: OpenAIChatRequest = {
        messages: [{ role: 'user', content: 'Test message' }],
        model: 'gpt-4',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'Response' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
          model: 'gpt-4',
        }),
      });

      await provider.chat(request);

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body).not.toHaveProperty('reasoning_effort');
    });
  });

  describe('Response Handling', () => {
    it('should include reasoningTokens in usage when present in response', async () => {
      const request: OpenAIChatRequest = {
        messages: [{ role: 'user', content: 'Test message' }],
        features: {
          reasoningEffort: 'high',
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'Response with reasoning' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 30,
            total_tokens: 40,
            reasoning_tokens: 15,
          },
          model: 'gpt-4',
        }),
      });

      const response = await provider.chat<string>(request);
      const typedResponse = response as OpenAIChatResponse<string>;

      expect(typedResponse.usage).toBeDefined();
      expect(typedResponse.reasoningTokens).toBe(15);
    });

    it('should handle response without reasoning_tokens gracefully', async () => {
      const request: OpenAIChatRequest = {
        messages: [{ role: 'user', content: 'Test message' }],
        features: {
          reasoningEffort: 'minimal',
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'Response' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
          model: 'gpt-4',
        }),
      });

      const response = await provider.chat<string>(request);
      const typedResponse = response as OpenAIChatResponse<string>;

      expect(typedResponse.usage).toBeDefined();
      expect(typedResponse.reasoningTokens).toBeUndefined();
    });
  });

  describe('Streaming with Reasoning', () => {
    it('should handle reasoning tokens in streaming response', async () => {
      const request: OpenAIChatRequest = {
        messages: [{ role: 'user', content: 'Test' }],
        stream: true,
        features: {
          reasoningEffort: 'high',
        },
      };

      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"reasoning_tokens":12}}\n\n',
        'data: [DONE]\n\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        },
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const response = await provider.stream(request);
      const complete = await response.complete();
      const typedComplete = complete as OpenAIChatResponse<string>;

      expect(typedComplete.reasoningTokens).toBe(12);
    });
  });
});
