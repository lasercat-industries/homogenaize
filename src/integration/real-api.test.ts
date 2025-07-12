import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { createOpenAILLM } from '../client';

// Skip these tests if no API keys are provided
const SKIP_REAL_TESTS = !process.env.OPENAI_API_KEY;

describe.skipIf(SKIP_REAL_TESTS)('Real API Integration Tests', () => {
  describe('OpenAI', () => {
    let client: ReturnType<typeof createOpenAILLM>;
    
    beforeAll(() => {
      client = createOpenAILLM({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'gpt-4o-mini'
      });
    });

    it('should make a real chat completion request', async () => {
      const response = await client.chat({
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Be concise.' },
          { role: 'user', content: 'Say hello in exactly 3 words.' }
        ],
        temperature: 0.1
      });

      expect(response.content).toBeTruthy();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.model).toContain('gpt');
      console.log('OpenAI response:', response.content);
    });

    it('should handle structured output', async () => {
      const schema = z.object({
        answer: z.number(),
        explanation: z.string()
      });

      const response = await client.chat({
        messages: [
          { role: 'user', content: 'What is 2+2? Give answer as number and explanation as string.' }
        ],
        schema,
        temperature: 0
      });

      expect(response.content).toMatchObject({
        answer: 4,
        explanation: expect.any(String)
      });
      console.log('Structured response:', response.content);
    });

    it('should handle streaming', async () => {
      const stream = await client.stream({
        messages: [
          { role: 'user', content: 'Count from 1 to 5, one number at a time.' }
        ],
        temperature: 0.1
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
          unit: z.string().optional()
        }),
        execute: async (params) => {
          // Simulate weather API
          return {
            location: params.location,
            temperature: 22,
            unit: params.unit || 'celsius',
            condition: 'sunny'
          };
        }
      });

      const response = await client.chat({
        messages: [
          { role: 'user', content: 'What is the weather in London, UK?' }
        ],
        tools: [weatherTool],
        toolChoice: 'auto'
      });

      // Check if the model decided to use the tool
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log('Tool calls:', response.toolCalls);
        
        // Execute the tool calls
        const toolResults = await client.executeTools(response.toolCalls);
        console.log('Tool execution results:', toolResults);
        expect(toolResults).toHaveLength(response.toolCalls.length);
        expect(toolResults[0].result).toHaveProperty('temperature');
      } else {
        console.log('Model chose not to use tools, response:', response.content);
      }
    });

    it('should handle forced tool usage', async () => {
      const calculatorTool = client.defineTool({
        name: 'calculate',
        description: 'Perform basic arithmetic calculations',
        schema: z.object({
          expression: z.string().describe('Mathematical expression to evaluate')
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
          } catch (error) {
            return { error: 'Failed to evaluate expression' };
          }
        }
      });

      const response = await client.chat({
        messages: [
          { role: 'user', content: 'Calculate 15 * 4 + 10' }
        ],
        tools: [calculatorTool],
        toolChoice: 'required' // Force tool usage
      });

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls!.length).toBeGreaterThan(0);
      expect(response.finishReason).toBe('tool_calls');

      const toolResults = await client.executeTools(response.toolCalls!);
      console.log('Forced tool usage results:', toolResults);
      expect(toolResults[0].result).toHaveProperty('result');
      expect(toolResults[0].result.result).toBe(70);
    });

    it('should handle OpenAI-specific features', async () => {
      const response = await client.chat({
        messages: [
          { role: 'user', content: 'Say "Hello World"' }
        ],
        features: {
          logprobs: true,
          topLogprobs: 2,
          seed: 12345
        },
        temperature: 0
      });

      expect(response.content).toContain('Hello World');
      if (response.logprobs) {
        console.log('Logprobs:', response.logprobs.slice(0, 3));
        expect(response.logprobs).toBeInstanceOf(Array);
        expect(response.logprobs[0]).toHaveProperty('token');
        expect(response.logprobs[0]).toHaveProperty('logprob');
      }
      if (response.systemFingerprint) {
        console.log('System fingerprint:', response.systemFingerprint);
      }
    });
  });
});