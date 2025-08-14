import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from './openai';
import { createLLM } from '../../client';

describe('OpenAI Discriminated Union Schema Conversion', () => {
  const provider = new OpenAIProvider('test-key');

  it('should throw error for discriminated unions with extended schemas', () => {
    // Define the schemas as provided by the user
    const BaseResponseSchema = z.strictObject({
      status: z.enum(['blocked', 'in-progress', 'completed', 'failed']),
      content: z.string(),
    });

    const InProgressResponseSchema = BaseResponseSchema.extend({
      status: z.literal('in-progress'),
      nextAction: z.strictObject({
        type: z.enum(['continue']),
        reason: z.string(),
      }),
    });

    const CompletedResponseSchema = BaseResponseSchema.extend({
      status: z.literal('completed'),
      completion: z.strictObject({
        summary: z.string(),
        artifacts: z.array(z.any()),
      }),
    });

    const FailedResponseSchema = BaseResponseSchema.extend({
      status: z.literal('failed'),
      error: z.strictObject({
        message: z.string(),
        recoverable: z.boolean(),
      }),
    });

    const AgentResponseSchema = z.discriminatedUnion('status', [
      InProgressResponseSchema,
      CompletedResponseSchema,
      FailedResponseSchema,
    ]);

    // Create a request to test schema conversion
    const request = {
      messages: [{ role: 'user' as const, content: 'test' }],
      schema: AgentResponseSchema,
      model: 'gpt-4o-mini' as const,
    };

    // Should throw error when trying to use discriminated union
    expect(() => {
      (provider as any).transformRequest(request);
    }).toThrow('Discriminated unions are not supported with OpenAI strict mode');

    // Verify the error message includes helpful guidance
    let error: Error | null = null;
    try {
      (provider as any).transformRequest(request);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain('discriminated union');
    expect(error!.message).toContain('oneOf');
    expect(error!.message).toContain('refactor');
    expect(error!.message).toContain('z.object({ type: z.enum([...]), ...fields })');
  });

  it('should reject discriminated union in real API call', async () => {
    // Skip if no API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      console.log('Skipping real API test - no OpenAI API key');
      return;
    }

    const client = createLLM({
      provider: 'openai',
      apiKey,
      model: 'gpt-4o-mini',
    });

    const BaseResponseSchema = z.strictObject({
      status: z.enum(['blocked', 'in-progress', 'completed', 'failed']),
      content: z.string(),
    });

    const InProgressResponseSchema = BaseResponseSchema.extend({
      status: z.literal('in-progress'),
      nextAction: z.strictObject({
        type: z.enum(['continue']),
        reason: z.string(),
      }),
    });

    const CompletedResponseSchema = BaseResponseSchema.extend({
      status: z.literal('completed'),
      completion: z.strictObject({
        summary: z.string(),
        artifacts: z.array(z.any()),
      }),
    });

    const FailedResponseSchema = BaseResponseSchema.extend({
      status: z.literal('failed'),
      error: z.strictObject({
        message: z.string(),
        recoverable: z.boolean(),
      }),
    });

    const AgentResponseSchema = z.discriminatedUnion('status', [
      InProgressResponseSchema,
      CompletedResponseSchema,
      FailedResponseSchema,
    ]);

    // Log the actual request being made
    const request = {
      messages: [
        {
          role: 'user' as const,
          content:
            'Generate a response with status "completed", content "Task finished successfully", and a completion with summary "All steps completed" and empty artifacts array',
        },
      ],
      schema: AgentResponseSchema,
      model: 'gpt-4o-mini' as const,
    };

    // Should throw error when trying to use discriminated union
    try {
      await client.chat(request);
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect((error as Error).message).toContain(
        'Discriminated unions are not supported with OpenAI strict mode',
      );
    }
  });
});
