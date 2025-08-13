import { describe, expect, it, beforeEach } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from './openai/openai';
import { AnthropicProvider } from './anthropic/anthropic';
import { GeminiProvider } from './gemini/gemini';
import type { GenericJSONSchema } from '../types/schema';
import { isJSONSchema, isZodSchema } from '../utils/schema-utils';
import { validateJSONSchema } from '../utils/json-schema-validator';

describe('JSON Schema Support', () => {
  describe('Schema Detection', () => {
    it('should correctly identify Zod schemas', () => {
      const zodSchema = z.object({
        name: z.string(),
        age: z.number(),
      });

      expect(isZodSchema(zodSchema)).toBe(true);
      expect(isJSONSchema(zodSchema)).toBe(false);
    });

    it('should correctly identify JSON schemas', () => {
      const jsonSchema: GenericJSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      expect(isJSONSchema(jsonSchema)).toBe(true);
      expect(isZodSchema(jsonSchema)).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(isJSONSchema(null)).toBe(false);
      expect(isJSONSchema(undefined)).toBe(false);
      expect(isZodSchema(null)).toBe(false);
      expect(isZodSchema(undefined)).toBe(false);
    });
  });

  describe('JSON Schema Validation', () => {
    const schema: GenericJSONSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number', minimum: 0 },
        email: { type: 'string', format: 'email' },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    };

    it('should validate valid data', () => {
      const data = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      };

      const result = validateJSONSchema(schema, data);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data).toEqual(data);
      }
    });

    it('should reject invalid data', () => {
      const data = {
        name: 'John Doe',
        age: -5, // Invalid: negative age
      };

      const result = validateJSONSchema(schema, data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should reject data with missing required fields', () => {
      const data = {
        name: 'John Doe',
        // Missing required 'age' field
      };

      const result = validateJSONSchema(schema, data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('required'))).toBe(true);
      }
    });

    it('should reject data with additional properties when not allowed', () => {
      const data = {
        name: 'John Doe',
        age: 30,
        extra: 'field', // Not allowed
      };

      const result = validateJSONSchema(schema, data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('additional'))).toBe(true);
      }
    });
  });

  describe('Provider Integration', () => {
    // Mock providers for testing
    let openaiProvider: OpenAIProvider;
    let anthropicProvider: AnthropicProvider;
    let geminiProvider: GeminiProvider;

    beforeEach(() => {
      openaiProvider = new OpenAIProvider('test-key');
      anthropicProvider = new AnthropicProvider('test-key');
      geminiProvider = new GeminiProvider('test-key');
    });

    const jsonSchema: GenericJSONSchema = {
      type: 'object',
      properties: {
        message: { type: 'string' },
        sentiment: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral'],
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['message', 'sentiment', 'confidence'],
    };

    const zodSchema = z.object({
      message: z.string(),
      sentiment: z.enum(['positive', 'negative', 'neutral']),
      confidence: z.number().min(0).max(1),
    });

    it('should handle JSON Schema in OpenAI transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: jsonSchema,
        model: 'gpt-4' as const,
      };

      // Test that transformRequest handles JSON Schema
      const transformed = (openaiProvider as any).transformRequest(request);
      expect(transformed.tools).toBeDefined();
      expect(transformed.tools[0].function.parameters).toEqual(jsonSchema);
    });

    it('should handle Zod Schema in OpenAI transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: zodSchema,
        model: 'gpt-4' as const,
      };

      // Test that transformRequest handles Zod Schema
      const transformed = (openaiProvider as any).transformRequest(request);
      expect(transformed.tools).toBeDefined();
      expect(transformed.tools[0].function.parameters).toBeDefined();
      expect(transformed.tools[0].function.parameters.type).toBe('object');
    });

    it('should handle JSON Schema in Anthropic transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: jsonSchema,
        model: 'claude-3-opus-20240229' as const,
      };

      // Test that transformRequest handles JSON Schema
      const transformed = (anthropicProvider as any).transformRequest(request);
      expect(transformed.tools).toBeDefined();
      expect(transformed.tools[0].input_schema).toEqual(jsonSchema);
    });

    it('should handle JSON Schema in Gemini transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: jsonSchema,
        model: 'gemini-pro' as const,
      };

      // Test that transformRequest handles JSON Schema with native structured output
      const transformed = (geminiProvider as any).transformRequest(request);
      expect(transformed.tools).toBeUndefined();
      expect(transformed.generationConfig.responseMimeType).toBe('application/json');
      expect(transformed.generationConfig.responseSchema).toBeDefined();
      expect(transformed.generationConfig.responseSchema.type).toBe('OBJECT');
    });
  });

  describe('Complex JSON Schema', () => {
    it('should handle nested objects', () => {
      const schema: GenericJSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              profile: {
                type: 'object',
                properties: {
                  age: { type: 'number' },
                  city: { type: 'string' },
                },
              },
            },
          },
        },
      };

      const validData = {
        user: {
          name: 'Alice',
          profile: {
            age: 25,
            city: 'NYC',
          },
        },
      };

      const result = validateJSONSchema(schema, validData);
      expect(result.valid).toBe(true);
    });

    it('should handle arrays', () => {
      const schema: GenericJSONSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
              },
              required: ['id', 'name'],
            },
            minItems: 1,
            maxItems: 5,
          },
        },
        required: ['items'],
      };

      const validData = {
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
      };

      const result = validateJSONSchema(schema, validData);
      expect(result.valid).toBe(true);
    });

    it('should handle oneOf schemas', () => {
      const schema: GenericJSONSchema = {
        type: 'object',
        properties: {
          result: {
            oneOf: [
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: true },
                  data: { type: 'string' },
                },
                required: ['success', 'data'],
              },
              {
                type: 'object',
                properties: {
                  success: { type: 'boolean', const: false },
                  error: { type: 'string' },
                },
                required: ['success', 'error'],
              },
            ],
          },
        },
        required: ['result'],
      };

      const validData1 = {
        result: {
          success: true,
          data: 'Operation completed',
        },
      };

      const validData2 = {
        result: {
          success: false,
          error: 'Operation failed',
        },
      };

      const result1 = validateJSONSchema(schema, validData1);
      const result2 = validateJSONSchema(schema, validData2);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });
});
