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
    const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      console.log('Skipping OpenAI test - no API key found');
      return;
    }

    const provider = new OpenAIProvider(apiKey);

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
  });
});
