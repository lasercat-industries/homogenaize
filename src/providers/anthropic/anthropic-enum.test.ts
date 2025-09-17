import { describe, expect, it, beforeEach } from 'bun:test';
import { z } from 'zod';
import { AnthropicProvider } from './anthropic';

describe('Anthropic Enum Support', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider('test-key');
  });

  describe('Basic Enum Handling', () => {
    it('should correctly transform simple enum to JSON schema', () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive', 'pending']),
        priority: z.enum(['low', 'medium', 'high']),
      });

      const request = {
        messages: [{ role: 'user' as const, content: 'test' }],
        schema,
        model: 'claude-3-opus-20240229' as const,
      };

      const transformed = (provider as any).transformRequest(request);

      expect(transformed.tools).toBeDefined();
      expect(transformed.tools[0].input_schema).toBeDefined();

      const toolSchema = transformed.tools[0].input_schema;
      expect(toolSchema.properties.status).toEqual({
        type: 'string',
        enum: ['active', 'inactive', 'pending'],
      });
      expect(toolSchema.properties.priority).toEqual({
        type: 'string',
        enum: ['low', 'medium', 'high'],
      });
    });

    it('should handle nested objects with enums', () => {
      const schema = z.object({
        user: z.object({
          role: z.enum(['admin', 'user', 'guest']),
          status: z.enum(['online', 'offline', 'away']),
        }),
        settings: z.object({
          theme: z.enum(['light', 'dark', 'auto']),
        }),
      });

      const request = {
        messages: [{ role: 'user' as const, content: 'test' }],
        schema,
        model: 'claude-3-opus-20240229' as const,
      };

      const transformed = (provider as any).transformRequest(request);
      const toolSchema = transformed.tools[0].input_schema;

      expect(toolSchema.properties.user.properties.role).toEqual({
        type: 'string',
        enum: ['admin', 'user', 'guest'],
      });
      expect(toolSchema.properties.user.properties.status).toEqual({
        type: 'string',
        enum: ['online', 'offline', 'away'],
      });
      expect(toolSchema.properties.settings.properties.theme).toEqual({
        type: 'string',
        enum: ['light', 'dark', 'auto'],
      });
    });

    it('should handle arrays of enums', () => {
      const schema = z.object({
        permissions: z.array(z.enum(['read', 'write', 'delete', 'admin'])),
        tags: z.array(z.enum(['urgent', 'important', 'low-priority'])),
      });

      const request = {
        messages: [{ role: 'user' as const, content: 'test' }],
        schema,
        model: 'claude-3-opus-20240229' as const,
      };

      const transformed = (provider as any).transformRequest(request);
      const toolSchema = transformed.tools[0].input_schema;

      expect(toolSchema.properties.permissions.type).toBe('array');
      expect(toolSchema.properties.permissions.items).toEqual({
        type: 'string',
        enum: ['read', 'write', 'delete', 'admin'],
      });
      expect(toolSchema.properties.tags.type).toBe('array');
      expect(toolSchema.properties.tags.items).toEqual({
        type: 'string',
        enum: ['urgent', 'important', 'low-priority'],
      });
    });

    it('should handle optional enum fields', () => {
      const schema = z.object({
        requiredStatus: z.enum(['active', 'inactive']),
        optionalPriority: z.enum(['low', 'medium', 'high']).optional(),
      });

      const request = {
        messages: [{ role: 'user' as const, content: 'test' }],
        schema,
        model: 'claude-3-opus-20240229' as const,
      };

      const transformed = (provider as any).transformRequest(request);
      const toolSchema = transformed.tools[0].input_schema;

      expect(toolSchema.properties.requiredStatus).toEqual({
        type: 'string',
        enum: ['active', 'inactive'],
      });
      expect(toolSchema.properties.optionalPriority).toEqual({
        type: 'string',
        enum: ['low', 'medium', 'high'],
      });
      expect(toolSchema.required).toContain('requiredStatus');
      expect(toolSchema.required).not.toContain('optionalPriority');
    });

    it('should handle nullable enum fields', () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive']).nullable(),
        priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
      });

      const request = {
        messages: [{ role: 'user' as const, content: 'test' }],
        schema,
        model: 'claude-3-opus-20240229' as const,
      };

      const transformed = (provider as any).transformRequest(request);
      const toolSchema = transformed.tools[0].input_schema;

      // Nullable enums should still have the enum values
      // Anthropic will handle null values separately
      expect(toolSchema.properties.status).toEqual({
        type: 'string',
        enum: ['active', 'inactive'],
      });
      expect(toolSchema.properties.priority).toEqual({
        type: 'string',
        enum: ['low', 'medium', 'high'],
      });
    });

    it('should handle complex nested schema with multiple enums', () => {
      const schema = z.object({
        order: z.object({
          id: z.string(),
          status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
          payment: z.object({
            method: z.enum(['credit-card', 'paypal', 'bank-transfer']),
            status: z.enum(['pending', 'completed', 'failed']),
          }),
          items: z.array(
            z.object({
              id: z.string(),
              availability: z.enum(['in-stock', 'out-of-stock', 'pre-order']),
            }),
          ),
        }),
        customer: z.object({
          type: z.enum(['individual', 'business']),
          preferences: z.object({
            notifications: z.enum(['email', 'sms', 'both', 'none']),
          }),
        }),
      });

      const request = {
        messages: [{ role: 'user' as const, content: 'test' }],
        schema,
        model: 'claude-3-opus-20240229' as const,
      };

      const transformed = (provider as any).transformRequest(request);
      const toolSchema = transformed.tools[0].input_schema;

      // Check all enum fields are properly transformed
      expect(toolSchema.properties.order.properties.status.enum).toEqual([
        'pending',
        'processing',
        'shipped',
        'delivered',
      ]);
      expect(toolSchema.properties.order.properties.payment.properties.method.enum).toEqual([
        'credit-card',
        'paypal',
        'bank-transfer',
      ]);
      expect(toolSchema.properties.order.properties.payment.properties.status.enum).toEqual([
        'pending',
        'completed',
        'failed',
      ]);
      expect(
        toolSchema.properties.order.properties.items.items.properties.availability.enum,
      ).toEqual(['in-stock', 'out-of-stock', 'pre-order']);
      expect(toolSchema.properties.customer.properties.type.enum).toEqual([
        'individual',
        'business',
      ]);
      expect(
        toolSchema.properties.customer.properties.preferences.properties.notifications.enum,
      ).toEqual(['email', 'sms', 'both', 'none']);
    });
  });

  describe('Integration Tests', () => {
    it.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.VITE_ANTHROPIC_API_KEY)(
      'should handle enum validation in real API call',
      async () => {
        const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
        if (!apiKey) return;

        const provider = new AnthropicProvider(apiKey);

        const schema = z.object({
          status: z.enum(['active', 'inactive', 'pending']),
          priority: z.enum(['low', 'medium', 'high']),
          description: z.string(),
        });

        const response = await provider.chat({
          model: 'claude-3-haiku-20240307',
          messages: [
            {
              role: 'user',
              content:
                'Generate a task with status "active", priority "high", and a brief description.',
            },
          ],
          schema,
          maxTokens: 100,
        });

        expect(response.content).toBeDefined();
        expect(['active', 'inactive', 'pending']).toContain(response.content.status);
        expect(['low', 'medium', 'high']).toContain(response.content.priority);
        expect(response.content.description).toBeDefined();
      },
      30000,
    );

    it.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.VITE_ANTHROPIC_API_KEY)(
      'should handle complex enum schema in real API call',
      async () => {
        const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
        if (!apiKey) return;

        const provider = new AnthropicProvider(apiKey);

        const schema = z.object({
          order: z.object({
            status: z.enum(['pending', 'shipped', 'delivered']),
            paymentMethod: z.enum(['credit-card', 'paypal']),
          }),
          customerType: z.enum(['individual', 'business']),
        });

        const response = await provider.chat({
          model: 'claude-3-haiku-20240307',
          messages: [
            {
              role: 'user',
              content:
                'Generate an order with status "shipped", payment method "credit-card", and customer type "individual".',
            },
          ],
          schema,
          maxTokens: 100,
        });

        expect(response.content).toBeDefined();
        expect(['pending', 'shipped', 'delivered']).toContain(response.content.order.status);
        expect(['credit-card', 'paypal']).toContain(response.content.order.paymentMethod);
        expect(['individual', 'business']).toContain(response.content.customerType);
      },
      30000,
    );
  });
});
