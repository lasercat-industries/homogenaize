import { describe, expect, it, beforeEach } from 'bun:test';
import { GeminiProvider } from './gemini';

describe('Gemini JSON Schema to Native Conversion', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider('test-api-key');
  });

  describe('Basic Type Conversion', () => {
    it('should convert lowercase types to uppercase', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          count: { type: 'integer' },
          active: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object', properties: {} },
        },
        required: ['name', 'age'],
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      expect(result.type).toBe('OBJECT');
      expect(result.properties.name.type).toBe('STRING');
      expect(result.properties.age.type).toBe('NUMBER');
      expect(result.properties.count.type).toBe('INTEGER');
      expect(result.properties.active.type).toBe('BOOLEAN');
      expect(result.properties.tags.type).toBe('ARRAY');
      expect(result.properties.metadata.type).toBe('OBJECT');
      expect(result.required).toEqual(['name', 'age']);
    });
  });

  describe('Nested Object Conversion', () => {
    it('should convert nested objects with proper type capitalization', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  firstName: { type: 'string' },
                  age: { type: 'number' },
                  settings: {
                    type: 'object',
                    properties: {
                      theme: { type: 'string' },
                      notifications: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      // Check nested structure
      expect(result.type).toBe('OBJECT');
      expect(result.properties.user.type).toBe('OBJECT');
      expect(result.properties.user.properties.profile.type).toBe('OBJECT');
      expect(result.properties.user.properties.profile.properties.firstName.type).toBe('STRING');
      expect(result.properties.user.properties.profile.properties.age.type).toBe('NUMBER');

      const settings = result.properties.user.properties.profile.properties.settings;
      expect(settings.type).toBe('OBJECT');
      expect(settings.properties.theme.type).toBe('STRING');
      expect(settings.properties.notifications.type).toBe('BOOLEAN');
    });
  });

  describe('Array Items Conversion', () => {
    it('should convert array item schemas recursively', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                value: { type: 'number' },
                nested: {
                  type: 'object',
                  properties: {
                    flag: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      expect(result.properties.items.type).toBe('ARRAY');
      expect(result.properties.items.items.type).toBe('OBJECT');
      expect(result.properties.items.items.properties.id.type).toBe('STRING');
      expect(result.properties.items.items.properties.value.type).toBe('NUMBER');
      expect(result.properties.items.items.properties.nested.type).toBe('OBJECT');
      expect(result.properties.items.items.properties.nested.properties.flag.type).toBe('BOOLEAN');
    });

    it('should handle nested arrays', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          matrix: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'number' },
            },
          },
        },
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      expect(result.properties.matrix.type).toBe('ARRAY');
      expect(result.properties.matrix.items.type).toBe('ARRAY');
      expect(result.properties.matrix.items.items.type).toBe('NUMBER');
    });
  });

  describe('anyOf and Nullable Handling', () => {
    it('should convert anyOf with null to nullable field', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          optionalField: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      expect(result.properties.optionalField.type).toBe('STRING');
      expect(result.properties.optionalField.nullable).toBe(true);
    });

    it('should handle nested anyOf patterns', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          data: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  value: { type: 'number' },
                },
              },
              { type: 'null' },
            ],
          },
        },
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      expect(result.properties.data.type).toBe('OBJECT');
      expect(result.properties.data.nullable).toBe(true);
      expect(result.properties.data.properties.value.type).toBe('NUMBER');
    });
  });

  describe('Enum and Format Preservation', () => {
    it('should preserve enum values', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'active', 'completed'],
          },
        },
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      expect(result.properties.status.type).toBe('STRING');
      expect(result.properties.status.enum).toEqual(['pending', 'active', 'completed']);
    });

    it('should preserve format specifications', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
          },
          birthDate: {
            type: 'string',
            format: 'date',
          },
        },
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      expect(result.properties.email.format).toBe('email');
      expect(result.properties.birthDate.format).toBe('date');
    });
  });

  describe('Complex Real-World Schema', () => {
    it('should handle a complex nested schema with all features', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          order: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    productId: { type: 'string' },
                    quantity: { type: 'integer' },
                    price: { type: 'number' },
                    discount: {
                      anyOf: [{ type: 'number' }, { type: 'null' }],
                    },
                    metadata: {
                      type: 'object',
                      properties: {
                        tags: {
                          type: 'array',
                          items: { type: 'string' },
                        },
                        notes: {
                          anyOf: [{ type: 'string' }, { type: 'null' }],
                        },
                      },
                    },
                  },
                  required: ['productId', 'quantity', 'price'],
                },
              },
              customer: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: {
                    type: 'string',
                    format: 'email',
                  },
                  membershipLevel: {
                    type: 'string',
                    enum: ['bronze', 'silver', 'gold', 'platinum'],
                  },
                },
              },
            },
            required: ['id', 'items'],
          },
        },
        required: ['order'],
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gemini-pro',
      });

      const result = request.generationConfig.responseSchema;

      // Top level
      expect(result.type).toBe('OBJECT');
      expect(result.required).toEqual(['order']);

      // Order object
      const order = result.properties.order;
      expect(order.type).toBe('OBJECT');
      expect(order.required).toEqual(['id', 'items']);

      // Items array
      const items = order.properties.items;
      expect(items.type).toBe('ARRAY');
      expect(items.items.type).toBe('OBJECT');
      expect(items.items.properties.productId.type).toBe('STRING');
      expect(items.items.properties.quantity.type).toBe('INTEGER');
      expect(items.items.properties.price.type).toBe('NUMBER');
      expect(items.items.properties.discount.type).toBe('NUMBER');
      expect(items.items.properties.discount.nullable).toBe(true);
      expect(items.items.required).toEqual(['productId', 'quantity', 'price']);

      // Nested metadata
      const metadata = items.items.properties.metadata;
      expect(metadata.type).toBe('OBJECT');
      expect(metadata.properties.tags.type).toBe('ARRAY');
      expect(metadata.properties.tags.items.type).toBe('STRING');
      expect(metadata.properties.notes.type).toBe('STRING');
      expect(metadata.properties.notes.nullable).toBe(true);

      // Customer object
      const customer = order.properties.customer;
      expect(customer.type).toBe('OBJECT');
      expect(customer.properties.name.type).toBe('STRING');
      expect(customer.properties.email.type).toBe('STRING');
      expect(customer.properties.email.format).toBe('email');
      expect(customer.properties.membershipLevel.type).toBe('STRING');
      expect(customer.properties.membershipLevel.enum).toEqual([
        'bronze',
        'silver',
        'gold',
        'platinum',
      ]);
    });
  });
});
