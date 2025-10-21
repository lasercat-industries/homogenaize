import { describe, test, expect } from 'bun:test';
import type { ModelsForProvider } from './types';
import type { OpenaiModel, AnthropicModel, GeminiModel } from '../generated/model-types';

describe('ModelsForProvider type utility', () => {
  test('should resolve to OpenaiModel for openai provider', () => {
    type Result = ModelsForProvider<'openai'>;
    const model: Result = 'gpt-4o';

    // Type assertion to verify it resolves correctly
    const _typeCheck: OpenaiModel = model;
    expect(_typeCheck).toBe('gpt-4o');
  });

  test('should resolve to AnthropicModel for anthropic provider', () => {
    type Result = ModelsForProvider<'anthropic'>;
    const model: Result = 'claude-sonnet-4-5';

    // Type assertion to verify it resolves correctly
    const _typeCheck: AnthropicModel = model;
    expect(_typeCheck).toBe('claude-sonnet-4-5');
  });

  test('should resolve to GeminiModel for gemini provider', () => {
    type Result = ModelsForProvider<'gemini'>;
    const model: Result = 'gemini-2.5-flash';

    // Type assertion to verify it resolves correctly
    const _typeCheck: GeminiModel = model;
    expect(_typeCheck).toBe('gemini-2.5-flash');
  });

  test('should work with generic functions', () => {
    function getModelInfo<P extends 'openai' | 'anthropic' | 'gemini'>(
      provider: P,
      model: ModelsForProvider<P>,
    ): string {
      return `${provider}:${model}`;
    }

    expect(getModelInfo('openai', 'gpt-4o')).toBe('openai:gpt-4o');
    expect(getModelInfo('anthropic', 'claude-sonnet-4-5')).toBe('anthropic:claude-sonnet-4-5');
    expect(getModelInfo('gemini', 'gemini-2.5-flash')).toBe('gemini:gemini-2.5-flash');
  });

  test('should work in conditional type scenarios', () => {
    type ProviderConfig<P extends 'openai' | 'anthropic' | 'gemini'> = {
      provider: P;
      model: ModelsForProvider<P>;
    };

    const openaiConfig: ProviderConfig<'openai'> = {
      provider: 'openai',
      model: 'gpt-4o',
    };

    const anthropicConfig: ProviderConfig<'anthropic'> = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };

    const geminiConfig: ProviderConfig<'gemini'> = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    };

    expect(openaiConfig.model).toBe('gpt-4o');
    expect(anthropicConfig.model).toBe('claude-sonnet-4-5');
    expect(geminiConfig.model).toBe('gemini-2.5-flash');
  });
});
