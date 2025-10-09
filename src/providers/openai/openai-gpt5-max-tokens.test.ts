import { describe, expect, it } from 'bun:test';
import { createOpenAILLM } from '../../client';

// Skip these tests if no API key is provided
const SKIP_TESTS = !process.env.OPENAI_API_KEY;

describe.skipIf(SKIP_TESTS)('OpenAI GPT-5 max_completion_tokens', () => {
  it('should use max_completion_tokens for GPT-5 models', async () => {
    const client = createOpenAILLM({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-5-mini',
    });

    const response = await client.chat({
      messages: [
        {
          role: 'user',
          content: 'What is 2+2? Answer with just the number.',
        },
      ],
      maxTokens: 100,
    });

    console.log('GPT-5 response:', JSON.stringify(response, null, 2));

    // The key test is that the request doesn't error with "unsupported parameter"
    // If max_completion_tokens is working, the API accepts the request
    expect(response.model).toContain('gpt-5');
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
  });

  it('should still use max_tokens for GPT-4 models', async () => {
    const client = createOpenAILLM({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-4o-mini',
    });

    const response = await client.chat({
      messages: [
        {
          role: 'user',
          content: 'Say hello in exactly 2 words.',
        },
      ],
      maxTokens: 10,
      temperature: 0.1,
    });

    // Test should succeed without errors
    expect(response.content).toBeTruthy();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.model).toContain('gpt-4');
  });

  it('should handle GPT-5 with streaming', async () => {
    const client = createOpenAILLM({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-5-mini',
    });

    const stream = await client.stream({
      messages: [
        {
          role: 'user',
          content: 'What is 2+2? Answer with just the number.',
        },
      ],
      maxTokens: 100,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      console.log('Received chunk:', chunk);
      chunks.push(chunk);
    }

    console.log('All chunks:', chunks);
    console.log('Chunks length:', chunks.length);

    const complete = await stream.complete();
    console.log('Complete response:', JSON.stringify(complete, null, 2));

    // GPT-5 streaming might have different behavior - check the complete() response
    expect(complete.content).toBeTruthy();
    expect(complete.usage.totalTokens).toBeGreaterThan(0);
  });
});
