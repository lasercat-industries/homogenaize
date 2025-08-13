import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from './openai/openai';
import { AnthropicProvider } from './anthropic/anthropic';
import { GeminiProvider } from './gemini/gemini';

const testSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

describe('Structured Output via Tool Calling', () => {
  describe('OpenAI Provider', () => {
    it('should use native structured output when schema is provided', async () => {
      const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping OpenAI test - no API key found');
        return;
      }

      const provider = new OpenAIProvider(apiKey);

      // Spy on the transformRequest method to verify native response_format is used
      const originalTransform = provider['transformRequest'].bind(provider);
      let capturedRequest: any;
      provider['transformRequest'] = (request) => {
        const result = originalTransform(request);
        capturedRequest = result;
        return result;
      };

      const response = await provider.chat({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: 'Create a person with name John Doe, age 30, and email john@example.com',
          },
        ],
        schema: testSchema,
      });

      // Verify the response matches the schema
      const parsed = testSchema.parse(response.content);
      expect(parsed.name).toBe('John Doe');
      expect(parsed.age).toBe(30);
      expect(parsed.email).toBe('john@example.com');

      // Verify that native response_format was used (not tools)
      expect(capturedRequest.response_format).toBeDefined();
      expect(capturedRequest.response_format.type).toBe('json_schema');
      expect(capturedRequest.response_format.json_schema).toBeDefined();
      expect(capturedRequest.tools).toBeUndefined();
      expect(capturedRequest.tool_choice).toBeUndefined();
    });
  });

  describe('Anthropic Provider', () => {
    it('should use tool calling internally when schema is provided', async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.log('Skipping Anthropic test - no API key found');
        return;
      }

      const provider = new AnthropicProvider(apiKey);

      // Spy on the transformRequest method to verify tool is created
      const originalTransform = provider['transformRequest'].bind(provider);
      let capturedRequest: any;
      provider['transformRequest'] = (request) => {
        const result = originalTransform(request);
        capturedRequest = result;
        return result;
      };

      const response = await provider.chat({
        model: 'claude-3-haiku-20240307',
        messages: [
          {
            role: 'user',
            content: 'Create a person with name Jane Smith, age 25, and email jane@example.com',
          },
        ],
        schema: testSchema,
      });

      // Verify the response matches the schema
      const parsed = testSchema.parse(response.content);
      expect(parsed.name).toBe('Jane Smith');
      expect(parsed.age).toBe(25);
      expect(parsed.email).toBe('jane@example.com');

      // Verify that tools were created internally
      expect(capturedRequest.tools).toBeDefined();
      expect(capturedRequest.tools).toHaveLength(1);
      expect(capturedRequest.tool_choice).toEqual({
        type: 'tool',
        name: 'respond_with_structured_output',
      });
    });
  });

  describe('Gemini Provider', () => {
    it('should use native structured output when schema is provided', async () => {
      const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        console.log('Skipping Gemini test - no API key found');
        return;
      }

      const provider = new GeminiProvider(apiKey);

      // Spy on the transformRequest method to verify native structured output is used
      const originalTransform = provider['transformRequest'].bind(provider);
      let capturedRequest: any;
      provider['transformRequest'] = (request) => {
        const result = originalTransform(request);
        capturedRequest = result;
        return result;
      };

      const response = await provider.chat({
        model: 'gemini-1.5-flash',
        messages: [
          {
            role: 'user',
            content: 'Create a person with name Bob Johnson, age 35, and email bob@example.com',
          },
        ],
        schema: testSchema,
      });

      // Verify the response matches the schema
      const parsed = testSchema.parse(response.content);
      expect(parsed.name).toBe('Bob Johnson');
      expect(parsed.age).toBe(35);
      expect(parsed.email).toBe('bob@example.com');

      // Verify that native structured output was used (not tools)
      expect(capturedRequest.tools).toBeUndefined();
      expect(capturedRequest.generationConfig?.responseMimeType).toBe('application/json');
      expect(capturedRequest.generationConfig?.responseSchema).toBeDefined();
      expect(capturedRequest.generationConfig?.responseSchema?.type).toBe('OBJECT');
    });
  });
});
