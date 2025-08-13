import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createLLM } from './client';

describe('Client executeTools with toolName', () => {
  it('should include tool name in successful execution', async () => {
    const client = createLLM({
      provider: 'openai' as const,
      apiKey: 'test-key',
      model: 'gpt-4',
    });

    // Define a calculator tool
    client.defineTool({
      name: 'calculator',
      description: 'Performs basic math',
      schema: z.object({
        a: z.number(),
        b: z.number(),
        operation: z.enum(['add', 'subtract']),
      }),
      execute: async (params) => {
        return params.operation === 'add' ? params.a + params.b : params.a - params.b;
      },
    });

    const toolCalls = [
      {
        id: 'call-1',
        name: 'calculator',
        arguments: { a: 5, b: 3, operation: 'add' },
      },
    ];

    const results = await client.executeTools(toolCalls);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'calculator',
      result: 8,
    });
    expect(results[0]?.error).toBeUndefined();
  });

  it('should include tool name when tool is not found', async () => {
    const client = createLLM({
      provider: 'anthropic' as const,
      apiKey: 'test-key',
      model: 'claude-3-5-sonnet-20241022',
    });

    const toolCalls = [
      {
        id: 'call-1',
        name: 'unknown-tool',
        arguments: {},
      },
    ];

    const results = await client.executeTools(toolCalls);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'unknown-tool',
      result: null,
      error: 'Tool unknown-tool not found',
    });
  });

  it('should include tool name when execution fails', async () => {
    const client = createLLM({
      provider: 'gemini' as const,
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });

    // Define a tool that throws an error
    client.defineTool({
      name: 'failing-tool',
      description: 'A tool that fails',
      schema: z.object({
        input: z.string(),
      }),
      execute: async () => {
        throw new Error('Tool execution failed');
      },
    });

    const toolCalls = [
      {
        id: 'call-1',
        name: 'failing-tool',
        arguments: { input: 'test' },
      },
    ];

    const results = await client.executeTools(toolCalls);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'failing-tool',
      result: null,
      error: 'Tool execution failed',
    });
  });

  it('should handle multiple tool calls with names', async () => {
    const client = createLLM({
      provider: 'openai' as const,
      apiKey: 'test-key',
      model: 'gpt-4',
    });

    // Define multiple tools
    client.defineTool({
      name: 'calculator',
      description: 'Math operations',
      schema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async (params) => params.a + params.b,
    });

    client.defineTool({
      name: 'formatter',
      description: 'Text formatting',
      schema: z.object({
        text: z.string(),
        uppercase: z.boolean(),
      }),
      execute: async (params) =>
        params.uppercase ? params.text.toUpperCase() : params.text.toLowerCase(),
    });

    const toolCalls = [
      {
        id: 'call-1',
        name: 'calculator',
        arguments: { a: 10, b: 20 },
      },
      {
        id: 'call-2',
        name: 'formatter',
        arguments: { text: 'Hello World', uppercase: true },
      },
      {
        id: 'call-3',
        name: 'non-existent',
        arguments: {},
      },
    ];

    const results = await client.executeTools(toolCalls);

    expect(results).toHaveLength(3);

    expect(results[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'calculator',
      result: 30,
    });

    expect(results[1]).toMatchObject({
      toolCallId: 'call-2',
      toolName: 'formatter',
      result: 'HELLO WORLD',
    });

    expect(results[2]).toMatchObject({
      toolCallId: 'call-3',
      toolName: 'non-existent',
      result: null,
      error: 'Tool non-existent not found',
    });
  });
});
