import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from './client';

describe('Client List Models', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = mock() as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should list models through OpenAI client', async () => {
    const mockResponse = {
      data: [
        { id: 'gpt-4', created: 1687882411, owned_by: 'openai' },
        { id: 'gpt-3.5-turbo', created: 1677610602, owned_by: 'openai' },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4',
    });

    const models = await client.listModels();

    expect(models).toHaveLength(2);
    expect(models[0]?.id).toBe('gpt-4');
    expect(models[1]?.id).toBe('gpt-3.5-turbo');
  });

  it('should list models through Anthropic client', async () => {
    const mockResponse = {
      data: [
        {
          id: 'claude-3-opus-20240229',
          display_name: 'Claude 3 Opus',
          created_at: '2024-02-29T00:00:00Z',
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createAnthropicLLM({
      apiKey: 'test-key',
      model: 'claude-3-opus-20240229',
    });

    const models = await client.listModels();

    expect(models).toHaveLength(1);
    expect(models[0]?.name).toBe('Claude 3 Opus');
  });

  it('should list models through Gemini client', async () => {
    const mockResponse = {
      models: [
        {
          name: 'models/gemini-1.5-pro',
          displayName: 'Gemini 1.5 Pro',
          description: 'Mid-size model',
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const client = createGeminiLLM({
      apiKey: 'test-key',
      model: 'gemini-1.5-pro',
    });

    const models = await client.listModels();

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('gemini-1.5-pro');
    expect(models[0]?.description).toBe('Mid-size model');
  });
});
