import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from '../client';

// Skip tests if no API keys are available
const SKIP_OPENAI = !process.env.OPENAI_API_KEY && !process.env.VITE_OPENAI_API_KEY;
const SKIP_ANTHROPIC = !process.env.ANTHROPIC_API_KEY && !process.env.VITE_ANTHROPIC_API_KEY;
const SKIP_GEMINI = !process.env.GEMINI_API_KEY && !process.env.VITE_GEMINI_API_KEY;

// Number of iterations to test reliability
const ITERATIONS = 3;

// Complex schema to test edge cases
const ComplexSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150),
  email: z.string().email(),
  tags: z.array(z.string()).min(1).max(5),
  metadata: z.object({
    created: z.string().datetime(),
    score: z.number().min(0).max(1),
    verified: z.boolean(),
  }),
  status: z.enum(['active', 'inactive', 'pending']),
  optionalField: z.string().optional(),
});

type ComplexData = z.infer<typeof ComplexSchema>;

describe('Structured Output Reliability Tests', () => {
  describe.skipIf(SKIP_OPENAI)('OpenAI Provider', () => {
    const client = createOpenAILLM({
      apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || '',
      model: 'gpt-4o-mini',
    });

    it(`should return valid structured output ${ITERATIONS} times out of ${ITERATIONS}`, async () => {
      const results: ComplexData[] = [];
      const errors: Error[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        try {
          const response = await client.chat({
            messages: [
              {
                role: 'user',
                content: `Generate a user profile with:
                - A valid UUID for id
                - Name between 1-100 chars
                - Age between 0-150
                - Valid email
                - 1-5 tags
                - Metadata with ISO datetime, score 0-1, and verified boolean
                - Status as either active, inactive, or pending
                - Optionally include optionalField`,
              },
            ],
            schema: ComplexSchema,
            temperature: 0.3,
          });

          // Validate the response matches our schema
          const parsed = ComplexSchema.parse(response.content);
          results.push(parsed);

          // Additional validations
          expect(parsed.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );
          expect(parsed.age).toBeGreaterThanOrEqual(0);
          expect(parsed.age).toBeLessThanOrEqual(150);
          expect(parsed.metadata.score).toBeGreaterThanOrEqual(0);
          expect(parsed.metadata.score).toBeLessThanOrEqual(1);
          expect(['active', 'inactive', 'pending']).toContain(parsed.status);
        } catch (error) {
          errors.push(error as Error);
        }
      }

      // All iterations should succeed
      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(ITERATIONS);
    });
  });

  describe.skipIf(SKIP_ANTHROPIC)('Anthropic Provider', () => {
    const client = createAnthropicLLM({
      apiKey: process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '',
      model: 'claude-3-5-haiku-20241022',
    });

    it(`should return valid structured output ${ITERATIONS} times out of ${ITERATIONS}`, async () => {
      const results: ComplexData[] = [];
      const errors: Error[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        try {
          const response = await client.chat({
            messages: [
              {
                role: 'user',
                content: `Generate a user profile with:
                - A valid UUID for id
                - Name between 1-100 chars
                - Age between 0-150
                - Valid email
                - 1-5 tags
                - Metadata with ISO datetime, score 0-1, and verified boolean
                - Status as either active, inactive, or pending
                - Optionally include optionalField`,
              },
            ],
            schema: ComplexSchema,
            temperature: 0.3,
          });

          // Validate the response matches our schema
          const parsed = ComplexSchema.parse(response.content);
          results.push(parsed);

          // Additional validations
          expect(parsed.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );
          expect(parsed.age).toBeGreaterThanOrEqual(0);
          expect(parsed.age).toBeLessThanOrEqual(150);
          expect(parsed.metadata.score).toBeGreaterThanOrEqual(0);
          expect(parsed.metadata.score).toBeLessThanOrEqual(1);
          expect(['active', 'inactive', 'pending']).toContain(parsed.status);
        } catch (error) {
          errors.push(error as Error);
        }
      }
      // All iterations should succeed
      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(ITERATIONS);
    });
  });

  describe.skipIf(SKIP_GEMINI)('Gemini Provider', () => {
    const client = createGeminiLLM({
      apiKey: process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '',
      model: 'gemini-1.5-flash',
    });

    // Gemini-specific schema that's more lenient with UUID format
    const GeminiComplexSchema = z.object({
      id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
      name: z.string().min(1).max(100),
      age: z.number().int().min(0).max(150),
      email: z.string().email(),
      tags: z.array(z.string()).min(1).max(5),
      metadata: z.object({
        created: z.string().datetime(),
        score: z.number().min(0).max(1),
        verified: z.boolean(),
      }),
      status: z.enum(['active', 'inactive', 'pending']),
      optionalField: z.string().optional(),
    });

    it(`should return valid structured output ${ITERATIONS} times out of ${ITERATIONS}`, async () => {
      const results: ComplexData[] = [];
      const errors: Error[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        try {
          const response = await client.chat({
            messages: [
              {
                role: 'user',
                content: `Generate a user profile with:
                - A valid UUID for id (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
                - Name between 1-100 chars
                - Age between 0-150
                - Valid email
                - 1-5 tags
                - Metadata with ISO datetime, score 0-1, and verified boolean
                - Status as either active, inactive, or pending
                - Optionally include optionalField`,
              },
            ],
            schema: GeminiComplexSchema,
            temperature: 0.3,
          });

          // Validate the response matches our schema
          const parsed = GeminiComplexSchema.parse(response.content);
          results.push(parsed);

          // Additional validations
          expect(parsed.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );
          expect(parsed.age).toBeGreaterThanOrEqual(0);
          expect(parsed.age).toBeLessThanOrEqual(150);
          expect(parsed.metadata.score).toBeGreaterThanOrEqual(0);
          expect(parsed.metadata.score).toBeLessThanOrEqual(1);
          expect(['active', 'inactive', 'pending']).toContain(parsed.status);
        } catch (error) {
          errors.push(error as Error);
        }
      }

      // All iterations should succeed
      expect(errors).toHaveLength(0);
      expect(results).toHaveLength(ITERATIONS);

      // Note: Gemini may generate the same UUID multiple times, so we don't check for uniqueness
    });
  });

  describe('Edge Cases', () => {
    it.skipIf(SKIP_OPENAI)('should handle nested arrays and objects', async () => {
      const NestedSchema = z.object({
        users: z
          .array(
            z.object({
              name: z.string(),
              roles: z.array(z.enum(['admin', 'user', 'guest'])),
              permissions: z.object({
                read: z.boolean(),
                write: z.boolean(),
                delete: z.boolean(),
              }),
            }),
          )
          .min(1)
          .max(3),
      });

      const client = createOpenAILLM({
        apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || '',
        model: 'gpt-4o-mini',
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Generate 2 users with different roles (admin, user, or guest) and permissions',
          },
        ],
        schema: NestedSchema,
        temperature: 0.3,
      });

      const parsed = NestedSchema.parse(response.content);
      expect(parsed.users).toHaveLength(2);
      expect(parsed.users[0]?.roles.length).toBeGreaterThan(0);
      expect(parsed.users[0]?.permissions).toHaveProperty('read');
      expect(parsed.users[0]?.permissions).toHaveProperty('write');
      expect(parsed.users[0]?.permissions).toHaveProperty('delete');
    });

    it.skipIf(SKIP_OPENAI)('should handle numeric constraints', async () => {
      const NumericSchema = z.object({
        integers: z.array(z.number().int().min(-100).max(100)).length(5),
        floats: z.array(z.number().min(0).max(1).multipleOf(0.1)).length(3),
        percentage: z.number().min(0).max(100),
      });

      const client = createOpenAILLM({
        apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || '',
        model: 'gpt-4o-mini',
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'Generate numeric data with 5 integers between -100 and 100, 3 floats between 0 and 1 (multiples of 0.1), and a percentage',
          },
        ],
        schema: NumericSchema,
        temperature: 0.3,
      });

      const parsed = NumericSchema.parse(response.content);
      expect(parsed.integers).toHaveLength(5);
      expect(parsed.floats).toHaveLength(3);
      parsed.integers.forEach((n) => {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(-100);
        expect(n).toBeLessThanOrEqual(100);
      });
      parsed.floats.forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
        expect(Math.round(n * 10) / 10).toBe(n); // Check multiple of 0.1
      });
    });
  });
});
