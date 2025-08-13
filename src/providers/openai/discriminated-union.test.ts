import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from './openai';
import { createLLM } from '../../client';

describe('OpenAI Discriminated Union Schema Conversion', () => {
  const provider = new OpenAIProvider('test-key');

  it('should handle discriminated unions with extended schemas', () => {
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

    // Use the private method to test schema conversion
    const transformed = (provider as any).transformRequest(request);

    // Should use native response_format instead of tools
    expect(transformed.response_format).toBeDefined();
    expect(transformed.response_format.type).toBe('json_schema');
    expect(transformed.response_format.json_schema).toBeDefined();
    expect(transformed.response_format.json_schema.name).toBe('response');
    expect(transformed.response_format.json_schema.strict).toBe(false); // Disabled for oneOf
    expect(transformed.tools).toBeUndefined();
    expect(transformed.tool_choice).toBeUndefined();

    // Check the generated JSON schema
    const schema = transformed.response_format.json_schema.schema;

    // The discriminated union should be wrapped in a value property for OpenAI
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(schema.properties.value).toBeDefined();
    expect(schema.properties.value.oneOf).toBeDefined();
    expect(schema.properties.value.oneOf).toHaveLength(3); // 3 union variants
    expect(schema.required).toContain('value');
  });

  it('should handle discriminated union in real API call', async () => {
    // Skip if no API key
    const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      console.log('Skipping real API test - no OpenAI API key');
      return;
    }

    const client = createLLM({
      provider: 'openai',
      apiKey,
      model: 'gpt-4.1-mini',
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

    const response = await client.chat(request);

    // Validate the response - should be automatically unwrapped by the provider
    const parsed = AgentResponseSchema.parse(response.content);
    expect(parsed.status).toBe('completed');
    expect(parsed.content).toBeDefined();

    if (parsed.status === 'completed') {
      expect(parsed.completion).toBeDefined();
      expect(parsed.completion.summary).toBeDefined();
      expect(parsed.completion.artifacts).toBeInstanceOf(Array);
    }
  });
});
