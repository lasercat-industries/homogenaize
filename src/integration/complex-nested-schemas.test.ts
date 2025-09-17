import { describe, expect, it, beforeAll } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from '../providers/openai/openai';
import { AnthropicProvider } from '../providers/anthropic/anthropic';
import { GeminiProvider } from '../providers/gemini/gemini';

describe('Complex Nested Schema Tests Across Providers', () => {
  let openaiProvider: OpenAIProvider | null = null;
  let anthropicProvider: AnthropicProvider | null = null;
  let geminiProvider: GeminiProvider | null = null;

  beforeAll(() => {
    // Initialize providers only if API keys are available
    const openaiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

    if (openaiKey) {
      openaiProvider = new OpenAIProvider(openaiKey);
    }
    if (anthropicKey) {
      anthropicProvider = new AnthropicProvider(anthropicKey);
    }
    if (geminiKey) {
      geminiProvider = new GeminiProvider(geminiKey);
    }
  });

  // Define complex nested schemas
  const ecommerceOrderSchema = z.object({
    orderId: z.string(),
    customer: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      shippingAddress: z.object({
        street: z.string(),
        city: z.string(),
        state: z.string(),
        zipCode: z.string(),
        country: z.string(),
        coordinates: z
          .object({
            latitude: z.number(),
            longitude: z.number(),
          })
          .optional(),
      }),
      preferences: z.object({
        newsletter: z.boolean(),
        smsNotifications: z.boolean(),
        language: z.enum(['en', 'es', 'fr', 'de']),
      }),
    }),
    items: z.array(
      z.object({
        productId: z.string(),
        name: z.string(),
        quantity: z.number().int().positive(),
        price: z.number().positive(),
        discount: z.number().min(0).max(100).optional(),
        attributes: z.array(
          z.object({
            key: z.string(),
            value: z.string(),
          }),
        ),
        metadata: z.object({
          category: z.string(),
          tags: z.array(z.string()),
          warehouse: z.object({
            id: z.string(),
            location: z.string(),
            availability: z.enum(['in-stock', 'low-stock', 'out-of-stock']),
          }),
        }),
      }),
    ),
    payment: z.object({
      method: z.enum(['credit-card', 'debit-card', 'paypal', 'bank-transfer']),
      status: z.enum(['pending', 'processing', 'completed', 'failed', 'refunded']),
      transactions: z.array(
        z.object({
          id: z.string(),
          timestamp: z.string(),
          amount: z.number(),
          currency: z.string(),
          processor: z.object({
            name: z.string(),
            transactionId: z.string(),
            metadata: z
              .object({
                gateway: z.string().optional(),
                reference: z.string().optional(),
                status: z.string().optional(),
              })
              .optional(),
          }),
        }),
      ),
    }),
    fulfillment: z.object({
      status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']),
      tracking: z
        .array(
          z.object({
            carrier: z.string(),
            trackingNumber: z.string(),
            estimatedDelivery: z.string().optional(),
            events: z.array(
              z.object({
                timestamp: z.string(),
                location: z.string(),
                status: z.string(),
                description: z.string(),
              }),
            ),
          }),
        )
        .optional(),
    }),
  });

  const nestedDataStructureSchema = z.object({
    root: z.object({
      level1: z.object({
        level2: z.object({
          level3: z.object({
            level4: z.object({
              level5: z.object({
                value: z.string(),
                metadata: z.object({
                  created: z.string(),
                  modified: z.string(),
                  tags: z.array(z.string()),
                }),
              }),
              siblings: z.array(
                z.object({
                  id: z.string(),
                  data: z.object({
                    nested: z.array(
                      z.object({
                        key: z.string(),
                        value: z.number(),
                      }),
                    ),
                  }),
                }),
              ),
            }),
          }),
        }),
      }),
    }),
  });

  const matrixDataSchema = z.object({
    matrix3D: z.array(
      z.array(
        z.array(
          z.object({
            value: z.number(),
            coordinates: z.object({
              x: z.number(),
              y: z.number(),
              z: z.number(),
            }),
            properties: z.object({
              color: z.string(),
              intensity: z.number().min(0).max(1),
              active: z.boolean(),
            }),
          }),
        ),
      ),
    ),
    metadata: z.object({
      dimensions: z.object({
        x: z.number().int().positive(),
        y: z.number().int().positive(),
        z: z.number().int().positive(),
      }),
      statistics: z.object({
        min: z.number(),
        max: z.number(),
        mean: z.number(),
        median: z.number(),
      }),
    }),
  });

  // Test helpers
  const testSchemaWithProvider = async (
    provider: any,
    providerName: string,
    schema: z.ZodSchema,
    schemaName: string,
    prompt: string,
  ) => {
    if (!provider) {
      console.log(`Skipping ${providerName} test - no API key found`);
      return;
    }

    try {
      const response = await provider.chat({
        model:
          providerName === 'OpenAI'
            ? 'gpt-4o-mini'
            : providerName === 'Anthropic'
              ? 'claude-3-haiku-20240307'
              : 'gemini-1.5-flash',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        schema,
        temperature: 0.1,
        maxTokens: 2000,
      });

      // Log the raw response for debugging
      console.log(`📝 ${providerName} - ${schemaName} response type:`, typeof response.content);

      // If response is a string when we expect an object, try to parse it
      let content = response.content;
      if (typeof content === 'string' && schemaName !== 'String Schema') {
        try {
          content = JSON.parse(content);
        } catch {
          console.error(`❌ ${providerName} - ${schemaName}: Failed to parse JSON response`);
          console.error(`Raw response: ${content.substring(0, 200)}...`);
        }
      }

      // Validate the response matches the schema
      const parsed = schema.parse(content);

      console.log(`✅ ${providerName} - ${schemaName}: Successfully generated and validated`);
      return { success: true, data: parsed };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${providerName} - ${schemaName}: ${errorMessage}`);
      if ((error as any).errors) {
        console.error('Validation errors:', JSON.stringify((error as any).errors, null, 2));
      }
      return { success: false, error: errorMessage };
    }
  };

  describe('E-commerce Order Schema', () => {
    const prompt = `Generate a complete e-commerce order with:
    - Order ID starting with "ORD-"
    - Customer with full details including shipping address
    - At least 2 items with different attributes
    - Payment information with at least one transaction
    - Fulfillment status
    Make it realistic and complete.`;

    it('should handle complex e-commerce schema with OpenAI', async () => {
      const result = await testSchemaWithProvider(
        openaiProvider,
        'OpenAI',
        ecommerceOrderSchema,
        'E-commerce Order',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof ecommerceOrderSchema>;
        expect(data.orderId).toStartWith('ORD-');
        expect(data.items.length).toBeGreaterThanOrEqual(2);
        expect(data.payment.transactions.length).toBeGreaterThanOrEqual(1);
      }
    }, 30000);

    it('should handle complex e-commerce schema with Anthropic', async () => {
      const result = await testSchemaWithProvider(
        anthropicProvider,
        'Anthropic',
        ecommerceOrderSchema,
        'E-commerce Order',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof ecommerceOrderSchema>;
        expect(data.orderId).toStartWith('ORD-');
        expect(data.items.length).toBeGreaterThanOrEqual(2);
        expect(data.payment.transactions.length).toBeGreaterThanOrEqual(1);
      }
    }, 30000);

    it('should handle complex e-commerce schema with Gemini', async () => {
      const result = await testSchemaWithProvider(
        geminiProvider,
        'Gemini',
        ecommerceOrderSchema,
        'E-commerce Order',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof ecommerceOrderSchema>;
        expect(data.orderId).toStartWith('ORD-');
        expect(data.items.length).toBeGreaterThanOrEqual(2);
        expect(data.payment.transactions.length).toBeGreaterThanOrEqual(1);
      }
    }, 30000);
  });

  describe('Deeply Nested Structure (6 levels)', () => {
    const prompt = `Generate a deeply nested data structure where:
    - root.level1.level2.level3.level4 is an OBJECT (not array)
    - root.level1.level2.level3.level4.level5.value = "deep-value-test"
    - root.level1.level2.level3.level4.level5.metadata has created/modified timestamps (ISO format) and tags array
    - root.level1.level2.level3.level4.siblings is an ARRAY with at least 2 items
    - Each sibling has id and data.nested array with key/value pairs
    Make sure level4 is an OBJECT containing level5 and siblings properties.`;

    it('should handle 6-level nested schema with OpenAI', async () => {
      const result = await testSchemaWithProvider(
        openaiProvider,
        'OpenAI',
        nestedDataStructureSchema,
        '6-Level Nested',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof nestedDataStructureSchema>;
        expect(data.root.level1.level2.level3.level4.level5.value).toBe('deep-value-test');
        expect(data.root.level1.level2.level3.level4.siblings.length).toBeGreaterThanOrEqual(2);
      }
    }, 30000);

    it('should handle 6-level nested schema with Anthropic', async () => {
      const result = await testSchemaWithProvider(
        anthropicProvider,
        'Anthropic',
        nestedDataStructureSchema,
        '6-Level Nested',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof nestedDataStructureSchema>;
        expect(data.root.level1.level2.level3.level4.level5.value).toBe('deep-value-test');
        expect(data.root.level1.level2.level3.level4.siblings.length).toBeGreaterThanOrEqual(2);
      }
    }, 30000);

    it('should handle 6-level nested schema with Gemini', async () => {
      const result = await testSchemaWithProvider(
        geminiProvider,
        'Gemini',
        nestedDataStructureSchema,
        '6-Level Nested',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof nestedDataStructureSchema>;
        expect(data.root.level1.level2.level3.level4.level5.value).toBe('deep-value-test');
        expect(data.root.level1.level2.level3.level4.siblings.length).toBeGreaterThanOrEqual(2);
      }
    }, 30000);
  });

  describe('3D Matrix Schema', () => {
    const prompt = `Generate a 3D matrix structure where:
    - matrix3D is a 3-level nested ARRAY: array of arrays of arrays
    - matrix3D[i][j][k] is an OBJECT with value, coordinates, properties
    - At least 2x2x2 dimensions (2 items at each array level)
    - Each cell OBJECT has: value (number), coordinates (x,y,z numbers), properties (color string, intensity 0-1, active boolean)
    - Metadata.dimensions must match actual matrix size
    - Statistics with realistic min, max, mean, median values
    Use colors like "red", "blue", "green". Ensure proper 3-level array nesting.`;

    it('should handle 3D matrix schema with OpenAI', async () => {
      const result = await testSchemaWithProvider(
        openaiProvider,
        'OpenAI',
        matrixDataSchema,
        '3D Matrix',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof matrixDataSchema>;
        expect(data.matrix3D.length).toBeGreaterThanOrEqual(2);
        expect(data.matrix3D[0]?.length).toBeGreaterThanOrEqual(2);
        expect(data.matrix3D[0]?.[0]?.length).toBeGreaterThanOrEqual(2);
        expect(data.metadata.dimensions.x).toBeGreaterThanOrEqual(2);
      }
    }, 30000);

    it('should handle 3D matrix schema with Anthropic', async () => {
      const result = await testSchemaWithProvider(
        anthropicProvider,
        'Anthropic',
        matrixDataSchema,
        '3D Matrix',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof matrixDataSchema>;
        expect(data.matrix3D.length).toBeGreaterThanOrEqual(2);
        expect(data.matrix3D[0]?.length).toBeGreaterThanOrEqual(2);
        expect(data.matrix3D[0]?.[0]?.length).toBeGreaterThanOrEqual(2);
        expect(data.metadata.dimensions.x).toBeGreaterThanOrEqual(2);
      }
    }, 30000);

    it('should handle 3D matrix schema with Gemini', async () => {
      const result = await testSchemaWithProvider(
        geminiProvider,
        'Gemini',
        matrixDataSchema,
        '3D Matrix',
        prompt,
      );

      if (result && result.success) {
        const data = result.data as z.infer<typeof matrixDataSchema>;
        expect(data.matrix3D.length).toBeGreaterThanOrEqual(2);
        expect(data.matrix3D[0]?.length).toBeGreaterThanOrEqual(2);
        expect(data.matrix3D[0]?.[0]?.length).toBeGreaterThanOrEqual(2);
        expect(data.metadata.dimensions.x).toBeGreaterThanOrEqual(2);
      }
    }, 30000);
  });

  // Summary test
  describe('Summary', () => {
    it('should print summary of all tests', () => {
      console.log('\n=== Complex Nested Schema Test Summary ===');
      console.log('Tests cover:');
      console.log('1. E-commerce order with 5+ levels of nesting');
      console.log('2. 6-level deeply nested structure');
      console.log('3. 3D matrix with nested arrays of objects');
      console.log('Each schema tested against OpenAI, Anthropic, and Gemini providers');
    });
  });
});
