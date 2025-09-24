import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { AnthropicProvider } from './anthropic';

describe('Anthropic Enum Integration Tests', () => {
  // Check if fetch is mocked - if so, skip these tests
  const fetchIsMocked = !!(global.fetch as any).mock;
  it.skipIf(
    (!process.env.ANTHROPIC_API_KEY && !process.env.VITE_ANTHROPIC_API_KEY) || fetchIsMocked,
  )(
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

  it.skipIf(
    (!process.env.ANTHROPIC_API_KEY && !process.env.VITE_ANTHROPIC_API_KEY) || fetchIsMocked,
  )(
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
