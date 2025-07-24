import { describe, expect, it, beforeAll } from 'bun:test';
import { z } from 'zod';
import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from '../client';

// Skip these tests if no API keys are provided
const SKIP_OPENAI_TESTS = !process.env.OPENAI_API_KEY;
const SKIP_ANTHROPIC_TESTS = !process.env.ANTHROPIC_API_KEY;
const SKIP_GEMINI_TESTS = !process.env.GEMINI_API_KEY;

describe('Real API Integration Tests', () => {
  describe.skipIf(SKIP_OPENAI_TESTS)('OpenAI', () => {
    let client: ReturnType<typeof createOpenAILLM>;

    beforeAll(() => {
      client = createOpenAILLM({
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-4o-mini',
      });
    });

    it('should make a real chat completion request', async () => {
      const response = await client.chat({
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise.' },
          { role: 'user', content: 'Say hello in exactly 3 words.' },
        ],
        temperature: 0.1,
      });

      expect(response.content).toBeTruthy();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.model).toContain('gpt');
    });

    it('should handle structured output', async () => {
      const schema = z.object({
        answer: z.number(),
        explanation: z.string(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'What is 2+2? Give answer as number and explanation as string.',
          },
        ],
        schema,
        temperature: 0,
      });

      expect(response.content).toMatchObject({
        answer: 4,
        explanation: expect.any(String),
      });
    });

    it('should handle streaming', async () => {
      const stream = await client.stream({
        messages: [{ role: 'user', content: 'Count from 1 to 5, one number at a time.' }],
        temperature: 0.1,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const fullResponse = chunks.join('');
      expect(fullResponse).toContain('1');
      expect(fullResponse).toContain('5');

      const complete = await stream.complete();
      expect(complete.content).toBe(fullResponse);
      expect(complete.usage.totalTokens).toBeGreaterThan(0);
    });

    it('should handle tool calls', async () => {
      // Define a weather tool
      const weatherTool = client.defineTool({
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        schema: z.object({
          location: z.string().describe('The city and country, e.g. "Paris, France"'),
          unit: z.string().optional(),
        }),
        execute: async (params) => {
          // Simulate weather API
          return {
            location: params.location,
            temperature: 22,
            unit: params.unit || 'celsius',
            condition: 'sunny',
          };
        },
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'What is the weather in London, UK?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // Check if the model decided to use the tool
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Execute the tool calls
        const toolResults = await client.executeTools(response.toolCalls);
        expect(toolResults).toHaveLength(response.toolCalls.length);
        if (toolResults[0]) {
          expect(toolResults[0].result).toHaveProperty('temperature');
        }
      } else {
        console.log('Model chose not to use tools, response:', response.content);
      }
    });

    it('should handle forced tool usage', async () => {
      const calculatorTool = client.defineTool({
        name: 'calculate',
        description: 'Perform basic arithmetic calculations',
        schema: z.object({
          expression: z.string().describe('Mathematical expression to evaluate'),
        }),
        execute: async (params) => {
          // Simple eval for demo - in production use a proper math parser
          try {
            // Only allow basic math operations
            if (!/^[\d\s+\-*/().]+$/.test(params.expression)) {
              throw new Error('Invalid expression');
            }
            const result = eval(params.expression);
            return { result, expression: params.expression };
          } catch {
            return { error: 'Failed to evaluate expression' };
          }
        },
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Calculate 15 * 4 + 10' }],
        tools: [calculatorTool],
        toolChoice: 'required', // Force tool usage
      });

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls!.length).toBeGreaterThan(0);
      expect(response.finishReason).toBe('tool_calls');

      const toolResults = await client.executeTools(response.toolCalls!);
      expect(toolResults[0]?.result).toHaveProperty('result');
      expect((toolResults[0]?.result as { result?: number })?.result).toBe(70);
    });

    it('should handle OpenAI-specific features', async () => {
      const response = await client.chat({
        messages: [{ role: 'user', content: 'Say "Hello World"' }],
        features: {
          logprobs: true,
          topLogprobs: 2,
          seed: 12345,
        },
        temperature: 0,
      });

      expect(response.content).toContain('Hello World');
      if (response.logprobs) {
        expect(response.logprobs).toBeInstanceOf(Array);
        expect(response.logprobs[0]).toHaveProperty('token');
        expect(response.logprobs[0]).toHaveProperty('logprob');
      }
    });
  });

  describe.skipIf(SKIP_ANTHROPIC_TESTS)('Anthropic', () => {
    let client: ReturnType<typeof createAnthropicLLM>;

    beforeAll(() => {
      client = createAnthropicLLM({
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        model: 'claude-3-opus-20240229',
      });
    });

    it('should make a real chat completion request', async () => {
      const response = await client.chat({
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise.' },
          { role: 'user', content: 'Say hello in exactly 3 words.' },
        ],
        temperature: 0.1,
      });

      expect(response.content).toBeTruthy();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.model).toContain('claude');
    });

    it('should handle structured output', async () => {
      const schema = z.object({
        answer: z.number(),
        explanation: z.string(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content: 'What is 2+2? Give answer as number and explanation as string.',
          },
        ],
        schema,
        temperature: 0,
      });

      expect(response.content).toMatchObject({
        answer: 4,
        explanation: expect.any(String),
      });
    });

    it('should handle streaming', async () => {
      const stream = await client.stream({
        messages: [
          { role: 'user', content: 'Please write a short message that says "Hello from Claude"' },
        ],
        temperature: 0,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const fullResponse = chunks.join('');
      expect(fullResponse.toLowerCase()).toContain('hello');
      expect(fullResponse.toLowerCase()).toContain('claude');

      const complete = await stream.complete();
      expect(complete.content).toBe(fullResponse);
      expect(complete.usage.totalTokens).toBeGreaterThan(0);
    });

    it('should handle tool calls', async () => {
      // Define a weather tool
      const weatherTool = client.defineTool({
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        schema: z.object({
          location: z.string().describe('The city and country, e.g. "Paris, France"'),
          unit: z.string().optional(),
        }),
        execute: async (params) => {
          // Simulate weather API
          return {
            location: params.location,
            temperature: 22,
            unit: params.unit || 'celsius',
            condition: 'sunny',
          };
        },
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'What is the weather in London, UK?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // Check if the model decided to use the tool
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Execute the tool calls
        const toolResults = await client.executeTools(response.toolCalls);
        expect(toolResults).toHaveLength(response.toolCalls.length);
        if (toolResults[0]) {
          expect(toolResults[0].result).toHaveProperty('temperature');
        }
      } else {
        console.log('Model chose not to use tools, response:', response.content);
      }
    });

    it('should handle forced tool usage', async () => {
      const calculatorTool = client.defineTool({
        name: 'calculate',
        description: 'Perform basic arithmetic calculations',
        schema: z.object({
          expression: z.string().describe('Mathematical expression to evaluate'),
        }),
        execute: async (params) => {
          // Simple eval for demo - in production use a proper math parser
          try {
            // Only allow basic math operations
            if (!/^[\d\s+\-*/().]+$/.test(params.expression)) {
              throw new Error('Invalid expression');
            }
            const result = eval(params.expression);
            return { result, expression: params.expression };
          } catch {
            return { error: 'Failed to evaluate expression' };
          }
        },
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Calculate 15 * 4 + 10' }],
        tools: [calculatorTool],
        toolChoice: 'required', // Force tool usage
      });

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls!.length).toBeGreaterThan(0);
      expect(response.finishReason).toBe('tool_use');

      const toolResults = await client.executeTools(response.toolCalls!);
      expect(toolResults[0]?.result).toHaveProperty('result');
      expect((toolResults[0]?.result as { result?: number })?.result).toBe(70);
    });

    it('should handle Anthropic-specific features', async () => {
      const response = await client.chat({
        messages: [{ role: 'user', content: 'Say "Hello World"' }],
        features: {
          thinking: true,
          cacheControl: true,
        },
        temperature: 0,
      });

      expect(response.content).toContain('Hello World');
    });
  });

  describe.skipIf(SKIP_GEMINI_TESTS)('Gemini', () => {
    let client: ReturnType<typeof createGeminiLLM>;

    beforeAll(() => {
      client = createGeminiLLM({
        apiKey: process.env.GEMINI_API_KEY || '',
        model: 'gemini-1.5-flash-latest',
      });
    });

    it('should make a real chat completion request', async () => {
      const response = await client.chat({
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise.' },
          { role: 'user', content: 'Say hello in exactly 3 words.' },
        ],
        temperature: 0.1,
      });

      expect(response.content).toBeTruthy();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.model).toContain('gemini');
    });

    it('should handle structured output', async () => {
      const schema = z.object({
        answer: z.number(),
        explanation: z.string(),
      });

      const response = await client.chat({
        messages: [
          {
            role: 'user',
            content:
              'What is 2+2? Respond in JSON with fields "answer" (number) and "explanation" (string).',
          },
        ],
        schema,
        temperature: 0,
      });

      expect(response.content).toMatchObject({
        answer: 4,
        explanation: expect.any(String),
      });
    });

    it('should handle streaming', async () => {
      const stream = await client.stream({
        messages: [{ role: 'user', content: 'Count from 1 to 3' }],
        temperature: 0,
        maxTokens: 100,
      });

      const chunks: string[] = [];
      try {
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
      } catch {
        console.error('Streaming error occurred');
      }

      const complete = await stream.complete();

      // Gemini might not support true streaming, so we check the complete response
      expect(complete.content.length).toBeGreaterThan(0);
      expect(complete.usage.totalTokens).toBeGreaterThan(0);

      // Either we got chunks or we got the complete response
      const hasContent = chunks.length > 0 || complete.content.length > 0;
      expect(hasContent).toBe(true);
    });

    it('should handle tool calls', async () => {
      // Define a weather tool
      const weatherTool = client.defineTool({
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        schema: z.object({
          location: z.string().describe('The city and country, e.g. "Paris, France"'),
          unit: z.string().optional(),
        }),
        execute: async (params) => {
          // Simulate weather API
          return {
            location: params.location,
            temperature: 22,
            unit: params.unit || 'celsius',
            condition: 'sunny',
          };
        },
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'What is the weather in London, UK?' }],
        tools: [weatherTool],
        toolChoice: 'auto',
      });

      // Check if the model decided to use the tool
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Execute the tool calls
        const toolResults = await client.executeTools(response.toolCalls);
        expect(toolResults).toHaveLength(response.toolCalls.length);
        if (toolResults[0]) {
          expect(toolResults[0].result).toHaveProperty('temperature');
        }
      } else {
        console.log('Model chose not to use tools, response:', response.content);
      }
    });

    it('should handle forced tool usage', async () => {
      const calculatorTool = client.defineTool({
        name: 'calculate',
        description: 'Perform basic arithmetic calculations',
        schema: z.object({
          expression: z.string().describe('Mathematical expression to evaluate'),
        }),
        execute: async (params) => {
          // Simple eval for demo - in production use a proper math parser
          try {
            // Only allow basic math operations
            if (!/^[\d\s+\-*/().]+$/.test(params.expression)) {
              throw new Error('Invalid expression');
            }
            const result = eval(params.expression);
            return { result, expression: params.expression };
          } catch {
            return { error: 'Failed to evaluate expression' };
          }
        },
      });

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Calculate 15 * 4 + 10' }],
        tools: [calculatorTool],
        toolChoice: 'required', // Force tool usage
      });

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls!.length).toBeGreaterThan(0);
      expect(response.finishReason).toContain('STOP');

      const toolResults = await client.executeTools(response.toolCalls!);
      expect(toolResults[0]?.result).toHaveProperty('result');
      expect((toolResults[0]?.result as { result?: number })?.result).toBe(70);
    });

    it('should handle Gemini-specific features', async () => {
      const response = await client.chat({
        messages: [{ role: 'user', content: 'Say "Hello World"' }],
        features: {
          safetySettings: [
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_ONLY_HIGH',
            },
          ],
        },
        temperature: 0,
      });

      expect(response.content).toContain('Hello World');
    });
  });
});
