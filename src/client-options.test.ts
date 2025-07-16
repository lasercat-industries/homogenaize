import { describe, it, expect } from 'vitest';
import type { ChatOptions, StreamOptions, DefineToolOptions, ExecuteToolsOptions } from './client';
import { z } from 'zod';

describe('Client Option Types', () => {
  it('should allow ChatOptions to be used in function signatures', () => {
    // This is a compile-time test - if it compiles, it works
    function testChatWrapper<T>(options: ChatOptions<'openai', T>) {
      // Just testing that the type can be used
      expect(options).toBeDefined();
    }

    const options: ChatOptions<'openai'> = {
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
    };

    testChatWrapper(options);
  });

  it('should allow StreamOptions to be used in function signatures', () => {
    function testStreamWrapper<T>(options: StreamOptions<'anthropic', T>) {
      expect(options).toBeDefined();
    }

    const options: StreamOptions<'anthropic'> = {
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 100,
    };

    testStreamWrapper(options);
  });

  it('should allow DefineToolOptions to be used', () => {
    const schema = z.object({ name: z.string() });

    const toolConfig: DefineToolOptions<typeof schema> = {
      name: 'test-tool',
      description: 'A test tool',
      schema,
      execute: async (params) => {
        return { result: `Hello ${params.name}` };
      },
    };

    expect(toolConfig.name).toBe('test-tool');
  });

  it('should allow ExecuteToolsOptions to be used', () => {
    const toolCalls: ExecuteToolsOptions = [
      {
        id: 'call-1',
        name: 'test-tool',
        arguments: { name: 'World' },
      },
    ];

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.name).toBe('test-tool');
  });

  it('should work with generic ChatOptions without provider', () => {
    // Test that ChatOptions works without specifying provider
    function genericWrapper(options: ChatOptions) {
      expect(options).toBeDefined();
    }

    const options: ChatOptions = {
      messages: [{ role: 'user', content: 'Hello' }],
    };

    genericWrapper(options);
  });
});
