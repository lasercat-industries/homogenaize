import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from './openai';

// The exact schema from the user
export const annotationResultSchema = z
  .object({
    id: z.string({ message: 'Annotation ID must be a string' }),
    relevanceScore: z
      .number({ message: 'Relevance score must be a number' })
      .min(0, { message: 'Relevance score must be at least 0' })
      .max(100, { message: 'Relevance score must not exceed 100' }),
    reason: z.string({ message: 'Reason must be a string' }),
  })
  .catchall(z.any().optional());

describe('OpenAI Schema Conversion', () => {
  it('should debug schema structure', () => {
    expect(annotationResultSchema._def).toBeDefined();
  });

  it('should handle structured output with annotation schema', async () => {
    // Check if fetch is mocked (from other tests running in parallel)
    if (typeof (global.fetch as any).mock !== 'undefined') {
      console.log('Skipping OpenAI test - fetch is mocked by another test');
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
    if (!apiKey || apiKey === 'test-key' || apiKey === 'sk-test') {
      console.log('Skipping OpenAI test - no valid API key found');
      return;
    }

    const provider = new OpenAIProvider(apiKey);

    try {
      const response = await provider.chat({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content:
              'Analyze this text and return a JSON object with id "test-123", relevanceScore 85, and reason "High relevance due to keyword matches": The quick brown fox jumps over the lazy dog.',
          },
        ],
        schema: annotationResultSchema,
      });

      // Validate the response matches the schema
      const parsed = annotationResultSchema.parse(response.content);
      expect(parsed.id).toBe('test-123');
      expect(parsed.relevanceScore).toBe(85);
      expect(parsed.reason).toBe('High relevance due to keyword matches');
    } catch (error) {
      // If running in CI or test environment without API key, skip gracefully
      if (error instanceof Error && error.message.includes('401')) {
        console.log('Skipping test - API authentication failed');
        return;
      }
      throw error;
    }
  });
});
