import { describe, it, expect } from 'vitest';
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
    it('should use tool calling internally when schema is provided', async () => {
      const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping OpenAI test - no API key found');
        return;
      }

      const provider = new OpenAIProvider(apiKey);

      // Spy on the transformRequest method to verify tool is created
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

      // Verify that tools were created internally
      expect(capturedRequest.tools).toBeDefined();
      expect(capturedRequest.tools).toHaveLength(1);
      expect(capturedRequest.tool_choice).toBe('required');
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
      expect(capturedRequest.tool_choice).toEqual({ type: 'any' });
    });
  });

  describe('Gemini Provider', () => {
    it('should use tool calling internally when schema is provided', async () => {
      const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        console.log('Skipping Gemini test - no API key found');
        return;
      }

      const provider = new GeminiProvider(apiKey);

      // Spy on the transformRequest method to verify tool is created
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

      // Verify that tools were created internally
      expect(capturedRequest.tools).toBeDefined();
      expect(capturedRequest.tools).toHaveLength(1);
      expect(capturedRequest.toolConfig?.functionCallingConfig?.mode).toBe('ANY');
    });
  });
});
