import { describe, expect, it } from 'bun:test';
import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from './client';
import type { OpenaiModel, AnthropicModel, GeminiModel } from './generated/model-types';

describe('Typed Model Names', () => {
  it('should accept valid OpenAI model names', () => {
    const validModels: OpenaiModel[] = ['gpt-4', 'gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini'];

    validModels.forEach((model) => {
      const client = createOpenAILLM({
        apiKey: 'test-key',
        model,
      });
      expect(client.model).toBe(model);
    });
  });

  it('should accept valid Anthropic model names', () => {
    const validModels: AnthropicModel[] = [
      'claude-3-opus-20240229',
      'claude-3-5-sonnet-20241022',
      'claude-3-haiku-20240307',
    ];

    validModels.forEach((model) => {
      const client = createAnthropicLLM({
        apiKey: 'test-key',
        model,
      });
      expect(client.model).toBe(model);
    });
  });

  it('should accept valid Gemini model names', () => {
    const validModels: GeminiModel[] = [
      'gemini-2.5-flash',
      'gemini-2.0-flash-exp',
      'gemini-2.0-flash',
    ];

    validModels.forEach((model) => {
      const client = createGeminiLLM({
        apiKey: 'test-key',
        model,
      });
      expect(client.model).toBe(model);
    });
  });

  // Type-level tests - these won't compile if types are wrong
  it('should provide autocomplete for model names', () => {
    // This test verifies that TypeScript provides proper autocomplete
    const openaiClient = createOpenAILLM({
      apiKey: 'test-key',
      model: 'gpt-4', // TypeScript should autocomplete valid models here
    });

    const anthropicClient = createAnthropicLLM({
      apiKey: 'test-key',
      model: 'claude-3-opus-20240229', // TypeScript should autocomplete valid models here
    });

    const geminiClient = createGeminiLLM({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash', // TypeScript should autocomplete valid models here
    });

    expect(openaiClient).toBeDefined();
    expect(anthropicClient).toBeDefined();
    expect(geminiClient).toBeDefined();
  });

  // The following would cause TypeScript compilation errors:
  // Invalid model name:
  // const invalidOpenAI = createOpenAILLM({ apiKey: 'test', model: 'invalid-model' });

  // Wrong provider model:
  // const wrongProvider = createOpenAILLM({ apiKey: 'test', model: 'claude-3-opus-20240229' });
});
