import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './openai/openai';
import { AnthropicProvider } from './anthropic/anthropic';
import { GeminiProvider } from './gemini/gemini';

describe('List Models Functionality', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('OpenAI Provider', () => {
    it('should list available models', async () => {
      const mockResponse = {
        data: [
          {
            id: 'gpt-4',
            object: 'model',
            created: 1687882411,
            owned_by: 'openai',
          },
          {
            id: 'gpt-3.5-turbo',
            object: 'model',
            created: 1677610602,
            owned_by: 'openai',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const provider = new OpenAIProvider('test-key');
      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'gpt-4',
        name: 'gpt-4',
      });
      expect(models[1]).toMatchObject({
        id: 'gpt-3.5-turbo',
        name: 'gpt-3.5-turbo',
      });

      expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer test-key',
        },
      });
    });

    it('should handle API errors', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: { message: 'Invalid API key' } }),
      });

      const provider = new OpenAIProvider('invalid-key');
      await expect(provider.listModels()).rejects.toThrow('OpenAI API error');
    });
  });

  describe('Anthropic Provider', () => {
    it('should list available models', async () => {
      const mockResponse = {
        data: [
          {
            id: 'claude-3-opus-20240229',
            display_name: 'Claude 3 Opus',
            created_at: '2024-02-29T00:00:00Z',
          },
          {
            id: 'claude-3-sonnet-20240229',
            display_name: 'Claude 3 Sonnet',
            created_at: '2024-02-29T00:00:00Z',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const provider = new AnthropicProvider('test-key');
      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
      });

      expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        },
      });
    });
  });

  describe('Gemini Provider', () => {
    it('should list available models', async () => {
      const mockResponse = {
        models: [
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            description: 'Mid-size multimodal model',
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          },
          {
            name: 'models/gemini-1.5-flash',
            displayName: 'Gemini 1.5 Flash',
            description: 'Fast and versatile multimodal model',
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const provider = new GeminiProvider('test-key');
      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Mid-size multimodal model',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models',
        {
          method: 'GET',
          headers: {
            'x-goog-api-key': 'test-key',
          },
        },
      );
    });
  });
});
