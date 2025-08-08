// import { describe, expect, it } from 'bun:test';
// import { z } from 'zod';

// // Import types and functions for generic API
// import {
//   createGenericLLM,
//   createGenericOpenAI,
//   createGenericAnthropic,
//   createGenericGemini,
// } from './generic-client';

// describe('Generic LLM Client', () => {
//   describe('Factory functions', () => {
//     it('should create generic client for OpenAI without type parameters', () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       // Should work without any type parameters
//       expect(client.provider).toBe('openai');
//       expect(client.model).toBe('gpt-4');
//       expect(client.apiKey).toBe('test-key');
//     });

//     it('should create generic client for Anthropic without type parameters', () => {
//       const client = createGenericLLM({
//         provider: 'anthropic',
//         apiKey: 'test-key',
//         model: 'claude-3-5-sonnet-20241022',
//       });

//       expect(client.provider).toBe('anthropic');
//       expect(client.model).toBe('claude-3-5-sonnet-20241022');
//       expect(client.apiKey).toBe('test-key');
//     });

//     it('should create generic client for Gemini without type parameters', () => {
//       const client = createGenericLLM({
//         provider: 'gemini',
//         apiKey: 'test-key',
//         model: 'gemini-1.5-pro',
//       });

//       expect(client.provider).toBe('gemini');
//       expect(client.model).toBe('gemini-1.5-pro');
//       expect(client.apiKey).toBe('test-key');
//     });

//     it('should create OpenAI client with specific generic factory', () => {
//       const client = createGenericOpenAI({
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       expect(client.provider).toBe('openai');
//       expect(client.model).toBe('gpt-4');
//     });

//     it('should create Anthropic client with specific generic factory', () => {
//       const client = createGenericAnthropic({
//         apiKey: 'test-key',
//         model: 'claude-3-5-sonnet-20241022',
//       });

//       expect(client.provider).toBe('anthropic');
//       expect(client.model).toBe('claude-3-5-sonnet-20241022');
//     });

//     it('should create Gemini client with specific generic factory', () => {
//       const client = createGenericGemini({
//         apiKey: 'test-key',
//         model: 'gemini-1.5-pro',
//       });

//       expect(client.provider).toBe('gemini');
//       expect(client.model).toBe('gemini-1.5-pro');
//     });
//   });

//   describe('Configuration', () => {
//     it('should accept string model names without type validation', () => {
//       // This should work with any string, unlike the type-safe API
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'some-future-model', // No compile-time validation
//       });

//       expect(client.model).toBe('some-future-model');
//     });

//     it('should accept default options', () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//         defaultOptions: {
//           temperature: 0.7,
//           maxTokens: 1000,
//         },
//       });

//       expect(client.defaultOptions?.temperature).toBe(0.7);
//       expect(client.defaultOptions?.maxTokens).toBe(1000);
//     });
//   });

//   describe('Client methods', () => {
//     it('should provide chat method without type parameters', async () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       // Should have chat method that accepts messages without type parameters
//       expect(typeof client.chat).toBe('function');

//       // Mock the chat method for testing
//       const mockChat = async () => ({
//         content: 'Hello!',
//         usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
//         model: 'gpt-4',
//       });

//       // Replace with mock for testing
//       (client as any).chat = mockChat;

//       const response = await client.chat({
//         messages: [{ role: 'user', content: 'Hello' }],
//       });

//       expect(response.content).toBe('Hello!');
//     });

//     it('should provide stream method without type parameters', async () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       // Should have stream method
//       expect(typeof client.stream).toBe('function');
//     });

//     it('should support structured output without type parameters', async () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       const schema = z.object({
//         sentiment: z.enum(['positive', 'negative', 'neutral']),
//         confidence: z.number(),
//       });

//       // Should accept schema without type parameters
//       expect(() => {
//         void client.chat({
//           messages: [{ role: 'user', content: 'Test' }],
//           schema,
//         });
//       }).not.toThrow();
//     });

//     it('should support tools without type parameters', async () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       const tool = client.defineTool({
//         name: 'get_weather',
//         description: 'Get weather info',
//         schema: z.object({
//           location: z.string(),
//         }),
//         execute: async ({ location }) => `Weather in ${location}`,
//       });

//       expect(tool.name).toBe('get_weather');
//       expect(typeof tool.execute).toBe('function');
//     });

//     it('should provide listModels method', async () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       expect(typeof client.listModels).toBe('function');
//     });

//     it('should provide executeTools method', async () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       expect(typeof client.executeTools).toBe('function');
//     });
//   });

//   describe('Provider switching without type changes', () => {
//     it('should allow runtime provider switching without changing variable types', () => {
//       // This demonstrates the key benefit: no type pollution
//       const providers = ['openai', 'anthropic', 'gemini'] as const;

//       for (const provider of providers) {
//         const client = createGenericLLM({
//           provider,
//           apiKey: 'test-key',
//           model: 'some-model',
//         });

//         // Same variable type, different providers
//         expect(client.provider).toBe(provider);
//         expect(typeof client.chat).toBe('function');
//       }
//     });

//     it('should work with dynamic provider selection', () => {
//       const getProviderFromConfig = () => 'openai'; // Simulate runtime provider selection

//       const client = createGenericLLM({
//         provider: getProviderFromConfig() as any,
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       expect(client.provider).toBe('openai');
//     });
//   });

//   describe('Generic vs Type-safe API comparison', () => {
//     it('should have same runtime behavior as type-safe API', () => {
//       // Generic API
//       const genericClient = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       // Both should have identical runtime behavior
//       expect(genericClient.provider).toBe('openai');
//       expect(genericClient.model).toBe('gpt-4');
//       expect(typeof genericClient.chat).toBe('function');
//       expect(typeof genericClient.stream).toBe('function');
//       expect(typeof genericClient.defineTool).toBe('function');
//     });
//   });

//   describe('Provider-specific features with generic API', () => {
//     it('should support OpenAI features without compile-time validation', () => {
//       const client = createGenericLLM({
//         provider: 'openai',
//         apiKey: 'test-key',
//         model: 'gpt-4',
//       });

//       // Should accept features but without compile-time type checking
//       expect(() => {
//         void client.chat({
//           messages: [{ role: 'user', content: 'Test' }],
//           features: {
//             logprobs: true,
//             topLogprobs: 5,
//           },
//         });
//       }).not.toThrow();
//     });

//     it('should support Anthropic features without compile-time validation', () => {
//       const client = createGenericLLM({
//         provider: 'anthropic',
//         apiKey: 'test-key',
//         model: 'claude-3-5-sonnet-20241022',
//       });

//       expect(() => {
//         void client.chat({
//           messages: [{ role: 'user', content: 'Test' }],
//           features: {
//             thinking: true,
//             cacheControl: true,
//           },
//         });
//       }).not.toThrow();
//     });
//   });
// });
