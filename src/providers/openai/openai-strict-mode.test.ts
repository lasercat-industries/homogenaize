import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

// We'll test the converter function directly once it's exported
// For now, we'll test via the provider's transformRequest method
import { OpenAIProvider } from './openai';

describe('OpenAI Strict Mode Schema Conversion', () => {
  describe('Union and Discriminated Union Rejection', () => {
    it('should throw clear error for discriminated unions', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('success'), data: z.string() }),
        z.object({ type: z.literal('error'), message: z.string() }),
      ]);

      const provider = new OpenAIProvider('test-key');

      expect(() => {
        (provider as any).transformRequest({
          messages: [{ role: 'user', content: 'test' }],
          schema,
          model: 'gpt-4',
        });
      }).toThrow('Discriminated unions are not supported with OpenAI strict mode');
    });

    it('should throw clear error for regular unions', () => {
      const schema = z.object({
        value: z.union([z.string(), z.number()]),
      });

      const provider = new OpenAIProvider('test-key');

      expect(() => {
        (provider as any).transformRequest({
          messages: [{ role: 'user', content: 'test' }],
          schema,
          model: 'gpt-4',
        });
      }).toThrow('Union types are not supported with OpenAI strict mode');
    });

    it('should throw error for union in tool parameters', () => {
      const provider = new OpenAIProvider('test-key');
      const toolSchema = z.union([z.string(), z.number()]);

      expect(() => {
        (provider as any).transformRequest({
          messages: [{ role: 'user', content: 'test' }],
          tools: [
            {
              name: 'test_tool',
              description: 'test',
              parameters: toolSchema,
            },
          ],
          model: 'gpt-4',
        });
      }).toThrow('Union types are not supported with OpenAI strict mode');
    });
  });

  describe('Optional Field Handling', () => {
    it('should convert optional string to null union', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      expect(request.response_format.json_schema.schema.properties.optional).toEqual({
        anyOf: [{ type: 'string' }, { type: 'null' }],
      });
      expect(request.response_format.json_schema.schema.required).toContain('optional');
    });

    it('should convert optional number to null union', () => {
      const schema = z.object({
        count: z.number().optional(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      expect(request.response_format.json_schema.schema.properties.count).toEqual({
        anyOf: [{ type: 'number' }, { type: 'null' }],
      });
    });

    it('should convert optional boolean to null union', () => {
      const schema = z.object({
        flag: z.boolean().optional(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      expect(request.response_format.json_schema.schema.properties.flag).toEqual({
        anyOf: [{ type: 'boolean' }, { type: 'null' }],
      });
    });

    it('should handle optional objects with anyOf', () => {
      const schema = z.object({
        metadata: z
          .object({
            key: z.string(),
          })
          .optional(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      expect(request.response_format.json_schema.schema.properties.metadata).toEqual({
        anyOf: [
          {
            type: 'object',
            properties: {
              key: { type: 'string' },
            },
            required: ['key'],
            additionalProperties: false,
          },
          { type: 'null' },
        ],
      });
    });

    it('should handle optional arrays with anyOf', () => {
      const schema = z.object({
        items: z.array(z.string()).optional(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      expect(request.response_format.json_schema.schema.properties.items).toEqual({
        anyOf: [
          {
            type: 'array',
            items: { type: 'string' },
          },
          { type: 'null' },
        ],
      });
    });
  });

  describe('Strict Mode Enforcement', () => {
    it('should always use strict mode for structured output', () => {
      const schema = z.object({
        name: z.string(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      expect(request.response_format.json_schema.strict).toBe(true);
    });

    it('should always use strict mode for tools', () => {
      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        tools: [
          {
            name: 'test_tool',
            description: 'test',
            parameters: z.object({ input: z.string() }),
          },
        ],
        model: 'gpt-4',
      });

      expect(request.tools[0].function.strict).toBe(true);
    });

    it('should use strict mode even with schema and tools together', () => {
      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: z.object({ result: z.string() }),
        tools: [
          {
            name: 'test_tool',
            description: 'test',
            parameters: z.object({ input: z.string() }),
          },
        ],
        model: 'gpt-4',
      });

      // Both should use strict mode
      expect(request.response_format.json_schema.strict).toBe(true);
      expect(request.tools[0].function.strict).toBe(true);
    });
  });

  describe('Schema Structure Requirements', () => {
    it('should add additionalProperties: false to all objects', () => {
      const schema = z.object({
        name: z.string(),
        nested: z.object({
          value: z.number(),
        }),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;
      expect(result.additionalProperties).toBe(false);
      expect(result.properties.nested.additionalProperties).toBe(false);
    });

    it('should include all fields in required array, even optionals', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
        nested: z
          .object({
            field: z.number(),
          })
          .optional(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;
      expect(result.required).toEqual(['required', 'optional', 'nested']);
    });
  });

  describe('Complex Schema Handling', () => {
    it('should handle nested objects with mixed optional fields', () => {
      const schema = z.object({
        user: z.object({
          id: z.string(),
          name: z.string().optional(),
          settings: z
            .object({
              theme: z.enum(['light', 'dark']),
              notifications: z.boolean().optional(),
            })
            .optional(),
        }),
        timestamp: z.number(),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;

      // Check user.name is anyOf with null
      expect(result.properties.user.properties.name).toEqual({
        anyOf: [{ type: 'string' }, { type: 'null' }],
      });

      // Check user.settings is anyOf with null
      expect(result.properties.user.properties.settings.anyOf).toBeDefined();
      expect(result.properties.user.properties.settings.anyOf).toContainEqual({
        type: 'null',
      });

      // Check strict mode is enabled
      expect(request.response_format.json_schema.strict).toBe(true);
    });

    it('should handle enums correctly', () => {
      const schema = z.object({
        status: z.enum(['pending', 'active', 'completed']),
      });

      const provider = new OpenAIProvider('test-key');
      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      expect(request.response_format.json_schema.schema.properties.status).toEqual({
        type: 'string',
        enum: ['pending', 'active', 'completed'],
      });
    });
  });

  describe('Error Messages', () => {
    it('should provide helpful error message for discriminated unions', () => {
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), value: z.string() }),
        z.object({ kind: z.literal('b'), count: z.number() }),
      ]);

      const provider = new OpenAIProvider('test-key');

      let error: Error | null = null;
      try {
        (provider as any).transformRequest({
          messages: [{ role: 'user', content: 'test' }],
          schema,
          model: 'gpt-4',
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error!.message).toContain('discriminated union');
      expect(error!.message).toContain('refactor');
      expect(error!.message).toContain('optional');
    });

    it('should provide helpful error message for unions', () => {
      const schema = z.union([z.string(), z.number()]);

      const provider = new OpenAIProvider('test-key');

      let error: Error | null = null;
      try {
        (provider as any).transformRequest({
          messages: [{ role: 'user', content: 'test' }],
          schema,
          model: 'gpt-4',
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error!.message).toContain('Union types');
      expect(error!.message).toContain('nullable fields');
    });
  });
});
