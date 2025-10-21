import { describe, test, expect } from 'bun:test';
import { isOpenAIModel, isAnthropicModel, isGeminiModel } from './model-types';

describe('Model Type Guards', () => {
  describe('isOpenAIModel', () => {
    test('should return true for valid OpenAI models', () => {
      expect(isOpenAIModel('gpt-4o')).toBe(true);
      expect(isOpenAIModel('gpt-4o-mini')).toBe(true);
      expect(isOpenAIModel('gpt-3.5-turbo')).toBe(true);
      expect(isOpenAIModel('gpt-5')).toBe(true);
      expect(isOpenAIModel('o1')).toBe(true);
    });

    test('should return false for invalid OpenAI models', () => {
      expect(isOpenAIModel('claude-3-opus')).toBe(false);
      expect(isOpenAIModel('gemini-2.5-flash')).toBe(false);
      expect(isOpenAIModel('invalid-model')).toBe(false);
      expect(isOpenAIModel('')).toBe(false);
    });

    test('should return false for Anthropic models', () => {
      expect(isOpenAIModel('claude-sonnet-4-5')).toBe(false);
      expect(isOpenAIModel('claude-3-haiku')).toBe(false);
    });

    test('should return false for Gemini models', () => {
      expect(isOpenAIModel('gemini-2.5-pro')).toBe(false);
      expect(isOpenAIModel('gemini-flash-latest')).toBe(false);
    });
  });

  describe('isAnthropicModel', () => {
    test('should return true for valid Anthropic models', () => {
      expect(isAnthropicModel('claude-sonnet-4-5')).toBe(true);
      expect(isAnthropicModel('claude-opus-4')).toBe(true);
      expect(isAnthropicModel('claude-3-haiku')).toBe(true);
      expect(isAnthropicModel('claude-3-opus-20240229')).toBe(true);
    });

    test('should return false for invalid Anthropic models', () => {
      expect(isAnthropicModel('gpt-4o')).toBe(false);
      expect(isAnthropicModel('gemini-2.5-flash')).toBe(false);
      expect(isAnthropicModel('invalid-model')).toBe(false);
      expect(isAnthropicModel('')).toBe(false);
    });

    test('should return false for OpenAI models', () => {
      expect(isAnthropicModel('gpt-5')).toBe(false);
      expect(isAnthropicModel('o1')).toBe(false);
    });

    test('should return false for Gemini models', () => {
      expect(isAnthropicModel('gemini-2.5-pro')).toBe(false);
      expect(isAnthropicModel('gemini-flash-latest')).toBe(false);
    });
  });

  describe('isGeminiModel', () => {
    test('should return true for valid Gemini models', () => {
      expect(isGeminiModel('gemini-2.5-flash')).toBe(true);
      expect(isGeminiModel('gemini-2.5-pro')).toBe(true);
      expect(isGeminiModel('gemini-flash-latest')).toBe(true);
      expect(isGeminiModel('gemini-2.0-flash')).toBe(true);
    });

    test('should return false for invalid Gemini models', () => {
      expect(isGeminiModel('gpt-4o')).toBe(false);
      expect(isGeminiModel('claude-3-opus')).toBe(false);
      expect(isGeminiModel('invalid-model')).toBe(false);
      expect(isGeminiModel('')).toBe(false);
    });

    test('should return false for OpenAI models', () => {
      expect(isGeminiModel('gpt-5')).toBe(false);
      expect(isGeminiModel('o1')).toBe(false);
    });

    test('should return false for Anthropic models', () => {
      expect(isGeminiModel('claude-sonnet-4-5')).toBe(false);
      expect(isGeminiModel('claude-3-haiku')).toBe(false);
    });
  });

  describe('Type narrowing', () => {
    test('should narrow type correctly for OpenAI', () => {
      const model: string = 'gpt-4o';

      if (isOpenAIModel(model)) {
        // TypeScript should know model is OpenaiModel here
        const typedModel: typeof model = model;
        expect(typedModel).toBe('gpt-4o');
      }
    });

    test('should narrow type correctly for Anthropic', () => {
      const model: string = 'claude-sonnet-4-5';

      if (isAnthropicModel(model)) {
        // TypeScript should know model is AnthropicModel here
        const typedModel: typeof model = model;
        expect(typedModel).toBe('claude-sonnet-4-5');
      }
    });

    test('should narrow type correctly for Gemini', () => {
      const model: string = 'gemini-2.5-flash';

      if (isGeminiModel(model)) {
        // TypeScript should know model is GeminiModel here
        const typedModel: typeof model = model;
        expect(typedModel).toBe('gemini-2.5-flash');
      }
    });
  });
});
