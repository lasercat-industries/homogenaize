import { describe, expect, it, beforeEach } from 'bun:test';
import type { JSONSchemaType } from 'ajv';
import type { GenericJSONSchema } from '../types/schema';
import { isZodSchema, isJSONSchema, isTypedJSONSchema } from '../utils/schema-utils';
import { validateJSONSchema } from '../utils/json-schema-validator';
import { OpenAIProvider } from './openai/openai';
import { AnthropicProvider } from './anthropic/anthropic';
import { GeminiProvider } from './gemini/gemini';

// Define a test interface
interface UserData {
  name: string;
  age: number;
  email?: string;
  tags: string[];
}

describe('Typed JSON Schema Support', () => {
  describe('Schema Type Detection', () => {
    it('should correctly identify typed JSON schemas', () => {
      const typedSchema: JSONSchemaType<UserData> = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
          email: { type: 'string', nullable: true },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['name', 'age', 'tags'],
        additionalProperties: false,
      };

      expect(isTypedJSONSchema(typedSchema)).toBe(true);
      expect(isJSONSchema(typedSchema)).toBe(true);
      expect(isZodSchema(typedSchema)).toBe(false);
    });

    it('should correctly identify generic JSON schemas', () => {
      const genericSchema: GenericJSONSchema = {
        type: 'object',
        properties: {
          dynamicField: { type: 'string' },
        },
      };

      expect(isJSONSchema(genericSchema)).toBe(true);
      expect(isTypedJSONSchema(genericSchema)).toBe(true); // Both are technically JSON schemas
      expect(isZodSchema(genericSchema)).toBe(false);
    });
  });

  describe('Typed Schema Validation', () => {
    const typedSchema: JSONSchemaType<UserData> = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        email: { type: 'string', nullable: true },
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['name', 'age', 'tags'],
      additionalProperties: false,
    };

    it('should validate data matching the typed schema', () => {
      const validData: UserData = {
        name: 'Alice',
        age: 30,
        email: 'alice@example.com',
        tags: ['developer', 'typescript'],
      };

      const result = validateJSONSchema(typedSchema, validData);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data).toEqual(validData);
      }
    });

    it('should validate data with optional fields', () => {
      const validData: UserData = {
        name: 'Bob',
        age: 25,
        tags: ['designer'],
        // email is optional
      };

      const result = validateJSONSchema(typedSchema, validData);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data).toEqual(validData);
      }
    });

    it('should reject data not matching the typed schema', () => {
      const invalidData = {
        name: 'Charlie',
        age: 'thirty', // Should be number
        tags: ['admin'],
      };

      const result = validateJSONSchema(typedSchema, invalidData);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.includes('must be') || e.includes('type'))).toBe(true);
      }
    });
  });

  describe('Provider Integration with Typed Schemas', () => {
    let openaiProvider: OpenAIProvider;
    let anthropicProvider: AnthropicProvider;
    let geminiProvider: GeminiProvider;

    beforeEach(() => {
      openaiProvider = new OpenAIProvider('test-key');
      anthropicProvider = new AnthropicProvider('test-key');
      geminiProvider = new GeminiProvider('test-key');
    });

    // Define typed schema
    const typedSchema: JSONSchemaType<{ result: string; score: number }> = {
      type: 'object',
      properties: {
        result: { type: 'string' },
        score: { type: 'number' },
      },
      required: ['result', 'score'],
      additionalProperties: false,
    };

    // Define generic schema for comparison
    const genericSchema: GenericJSONSchema = {
      type: 'object',
      properties: {
        result: { type: 'string' },
        score: { type: 'number' },
      },
      required: ['result', 'score'],
      additionalProperties: false,
    };

    it('should handle typed JSON Schema in OpenAI transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: typedSchema,
        model: 'gpt-4' as const,
      };

      // Test that transformRequest handles typed JSON Schema
      const transformed = (openaiProvider as any).transformRequest(request);
      expect(transformed.tools).toBeDefined();
      expect(transformed.tools[0].function.parameters).toEqual(typedSchema);
    });

    it('should handle generic JSON Schema in OpenAI transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: genericSchema,
        model: 'gpt-4' as const,
      };

      // Test that transformRequest handles generic JSON Schema
      const transformed = (openaiProvider as any).transformRequest(request);
      expect(transformed.tools).toBeDefined();
      expect(transformed.tools[0].function.parameters).toEqual(genericSchema);
    });

    it('should handle typed JSON Schema in Anthropic transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: typedSchema,
        model: 'claude-3-opus-20240229' as const,
      };

      // Test that transformRequest handles typed JSON Schema
      const transformed = (anthropicProvider as any).transformRequest(request);
      expect(transformed.tools).toBeDefined();
      expect(transformed.tools[0].input_schema).toEqual(typedSchema);
    });

    it('should handle typed JSON Schema in Gemini transformRequest', () => {
      const request = {
        messages: [{ role: 'user' as const, content: 'Test' }],
        schema: typedSchema,
        model: 'gemini-pro' as const,
      };

      // Test that transformRequest handles typed JSON Schema with native structured output
      const transformed = (geminiProvider as any).transformRequest(request);
      expect(transformed.tools).toBeUndefined();
      expect(transformed.generationConfig.responseMimeType).toBe('application/json');
      expect(transformed.generationConfig.responseSchema).toBeDefined();
      expect(transformed.generationConfig.responseSchema.type).toBe('OBJECT');
    });
  });

  describe('Type Safety Benefits', () => {
    it('demonstrates compile-time type checking with typed schemas', () => {
      interface StrictData {
        id: number;
        name: string;
        isActive: boolean;
        metadata?: {
          createdAt: string;
          updatedAt: string;
        };
      }

      // This schema is type-checked at compile time
      const strictSchema: JSONSchemaType<StrictData> = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
          metadata: {
            type: 'object',
            properties: {
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
            },
            required: ['createdAt', 'updatedAt'],
            nullable: true,
          },
        },
        required: ['id', 'name', 'isActive'],
        additionalProperties: false,
      };

      const validData: StrictData = {
        id: 1,
        name: 'Test Item',
        isActive: true,
        metadata: {
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        },
      };

      const result = validateJSONSchema(strictSchema, validData);
      expect(result.valid).toBe(true);
      if (result.valid) {
        // TypeScript knows result.data is StrictData
        const data: StrictData = result.data;
        expect(data.id).toBe(1);
        expect(data.name).toBe('Test Item');
      }
    });
  });
});
