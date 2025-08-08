// import { describe, expect, it } from 'bun:test';
// import {
//   // Type-safe API exports
//   createLLM,
//   createOpenAILLM,
//   createAnthropicLLM,
//   createGeminiLLM,
//   // Generic API exports
//   createGenericLLM,
//   createGenericOpenAI,
//   createGenericAnthropic,
//   createGenericGemini,
// } from './index';

// describe('Main exports', () => {
//   it('should export both type-safe and generic APIs', () => {
//     // Type-safe API functions should be available
//     expect(typeof createLLM).toBe('function');
//     expect(typeof createOpenAILLM).toBe('function');
//     expect(typeof createAnthropicLLM).toBe('function');
//     expect(typeof createGeminiLLM).toBe('function');

//     // Generic API functions should be available
//     expect(typeof createGenericLLM).toBe('function');
//     expect(typeof createGenericOpenAI).toBe('function');
//     expect(typeof createGenericAnthropic).toBe('function');
//     expect(typeof createGenericGemini).toBe('function');
//   });

//   it('should allow both APIs to work side by side', () => {
//     // Type-safe API
//     const typedClient = createOpenAILLM({
//       apiKey: 'test-key',
//       model: 'gpt-4',
//     });

//     // Generic API
//     const genericClient = createGenericOpenAI({
//       apiKey: 'test-key',
//       model: 'gpt-4',
//     });

//     // Both should work without conflicts
//     expect(typedClient.provider).toBe('openai');
//     expect(genericClient.provider).toBe('openai');

//     // Both should have the same interface methods
//     expect(typeof typedClient.chat).toBe('function');
//     expect(typeof genericClient.chat).toBe('function');
//   });

//   it('should demonstrate the key difference between APIs', () => {
//     // Generic API allows any string as model name
//     const genericClient = createGenericLLM({
//       provider: 'openai',
//       apiKey: 'test-key',
//       model: 'future-model-2025', // No compile-time validation
//     });

//     expect(genericClient.model).toBe('future-model-2025');
//   });
// });
