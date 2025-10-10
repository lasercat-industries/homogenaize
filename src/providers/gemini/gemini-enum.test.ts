import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, mock } from 'bun:test';
import { z } from 'zod';
import { GeminiProvider } from './gemini';

describe('Gemini Enum Handling', () => {
  let mockFetch: any;
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    mockFetch = mock();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should correctly convert Zod enums to Gemini native schema format', () => {
    const TestSchema = z.object({
      status: z.enum(['active', 'inactive', 'pending']),
      priority: z.enum(['low', 'medium', 'high']),
      description: z.string(),
    });

    const provider = new GeminiProvider('test-key');
    const request = (provider as any).transformRequest({
      messages: [{ role: 'user', content: 'Test' }],
      schema: TestSchema,
      model: 'gemini-2.5-flash',
    });

    // Check that the enum values are correctly included
    expect(request.generationConfig.responseMimeType).toBe('application/json');
    expect(request.generationConfig.responseSchema.properties.status.enum).toEqual([
      'active',
      'inactive',
      'pending',
    ]);
    expect(request.generationConfig.responseSchema.properties.priority.enum).toEqual([
      'low',
      'medium',
      'high',
    ]);
    expect(request.generationConfig.responseSchema.properties.description.type).toBe('STRING');
  });

  it('should handle successful enum validation when Gemini returns correct values', async () => {
    const TestSchema = z.object({
      status: z.enum(['active', 'inactive', 'pending']),
      priority: z.enum(['low', 'medium', 'high']),
      tasks: z.array(z.string()),
    });

    // Mock Gemini returning correct enum values
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    status: 'active', // Correct enum value
                    priority: 'high', // Correct enum value
                    tasks: ['fix bugs', 'add tests'],
                  }),
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
    });

    const provider = new GeminiProvider('test-key');
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'Create a task' }],
      model: 'gemini-2.5-flash',
      schema: TestSchema,
    });

    // Should return parsed object, not string
    expect(typeof response.content).toBe('object');
    expect(response.content).toEqual({
      status: 'active',
      priority: 'high',
      tasks: ['fix bugs', 'add tests'],
    });
  });

  it('should handle enum validation failure gracefully', async () => {
    const TestSchema = z.object({
      status: z.enum(['active', 'inactive', 'pending']),
      priority: z.enum(['low', 'medium', 'high']),
    });

    // Mock Gemini returning descriptive text instead of enum values
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    status: 'The project is currently active', // Wrong - not an enum value
                    priority: 'This is extremely important', // Wrong - not an enum value
                  }),
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
    });

    const provider = new GeminiProvider('test-key');

    // Should throw a ValidationError when enum values don't match
    expect(
      await provider.chat({
        messages: [{ role: 'user', content: 'Create a task' }],
        model: 'gemini-2.5-flash',
        schema: TestSchema,
      }),
    ).rejects.toThrow('Schema validation failed');
  });

  it('should correctly handle different Zod enum internal structures', () => {
    // Test enum with entries (most common)
    const EnumWithEntries = z.enum(['option1', 'option2']);

    // Test that our fix correctly extracts values from entries
    const provider = new GeminiProvider('test-key');
    const request = (provider as any).transformRequest({
      messages: [{ role: 'user', content: 'Test' }],
      schema: z.object({ choice: EnumWithEntries }),
      model: 'gemini-2.5-flash',
    });

    expect(request.generationConfig.responseSchema.properties.choice.enum).toEqual([
      'option1',
      'option2',
    ]);
  });

  it('should send correct request structure for schema with enums', () => {
    const ComplexSchema = z.object({
      name: z.string(),
      status: z.enum(['draft', 'published', 'archived']),
      tags: z.array(z.string()),
      metadata: z.object({
        version: z.number(),
        public: z.boolean(),
      }),
    });

    const provider = new GeminiProvider('test-key');
    const request = (provider as any).transformRequest({
      messages: [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Create an article' },
      ],
      schema: ComplexSchema,
      model: 'gemini-2.5-flash',
      temperature: 0.5,
      maxTokens: 1000,
    });

    // Verify complete request structure
    expect(request.generationConfig).toEqual({
      temperature: 0.5,
      maxOutputTokens: 1000,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          status: {
            type: 'STRING',
            enum: ['draft', 'published', 'archived'],
          },
          tags: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          metadata: {
            type: 'OBJECT',
            properties: {
              version: { type: 'NUMBER' },
              public: { type: 'BOOLEAN' },
            },
            required: ['version', 'public'],
            propertyOrdering: ['version', 'public'],
          },
        },
        required: ['name', 'status', 'tags', 'metadata'],
        propertyOrdering: ['name', 'status', 'tags', 'metadata'],
      },
    });
  });
});
