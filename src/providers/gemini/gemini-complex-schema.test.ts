import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { GeminiProvider } from './gemini';

// Complex schema from bug report
const ComplexSchema = z.object({
  briefSummary: z.string(),
  mainTopics: z.array(z.string()),
  userQuestions: z.array(
    z.object({
      question: z.string(),
      answered: z.boolean(),
      answerSummary: z.string().optional(),
    }),
  ),
  keyInformation: z.array(
    z.object({
      topic: z.string(),
      details: z.string(),
    }),
  ),
  resolution: z.enum(['fully_resolved', 'partially_resolved', 'unresolved']),
  tags: z.array(z.string()),
});

// Simple schema for comparison
const SimpleSchema = z.object({
  summary: z.string(),
  topics: z.array(z.string()),
  count: z.number(),
});

describe('Gemini Complex Schema Handling', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    provider = new GeminiProvider('test-api-key');
  });

  it('should handle complex schemas with nested object arrays', async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'respond_with_structured_output',
                  args: {
                    briefSummary: 'Discussion about BST implementation',
                    mainTopics: ['data structures', 'python', 'trees'],
                    userQuestions: [
                      {
                        question: 'How to implement BST in Python?',
                        answered: true,
                        answerSummary: 'Use Node class with insert method',
                      },
                    ],
                    keyInformation: [
                      {
                        topic: 'BST Implementation',
                        details: 'Binary search tree with Node class',
                      },
                    ],
                    resolution: 'fully_resolved',
                    tags: ['python', 'bst', 'algorithms'],
                  },
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await provider.chat({
      messages: [
        { role: 'user', content: 'How to implement BST in Python?' },
        { role: 'assistant', content: 'Use Node class with insert method' },
        { role: 'user', content: 'Summarize this conversation' },
      ],
      schema: ComplexSchema,
      model: 'gemini-1.5-flash',
      temperature: 0.3,
    });

    // Should successfully parse the complex schema
    expect(result.content).toBeDefined();
    expect(result.content).not.toBe('');
    expect(result.content).toMatchObject({
      briefSummary: 'Discussion about BST implementation',
      mainTopics: ['data structures', 'python', 'trees'],
      userQuestions: [
        {
          question: 'How to implement BST in Python?',
          answered: true,
          answerSummary: 'Use Node class with insert method',
        },
      ],
      keyInformation: [
        {
          topic: 'BST Implementation',
          details: 'Binary search tree with Node class',
        },
      ],
      resolution: 'fully_resolved',
      tags: ['python', 'bst', 'algorithms'],
    });

    expect(result.usage.outputTokens).toBe(50);
  });

  it('should handle simple schemas correctly', async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'respond_with_structured_output',
                  args: {
                    summary: 'BST implementation discussion',
                    topics: ['python', 'data structures'],
                    count: 2,
                  },
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 30,
        totalTokenCount: 130,
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await provider.chat({
      messages: [
        { role: 'user', content: 'How to implement BST in Python?' },
        { role: 'assistant', content: 'Use Node class with insert method' },
        { role: 'user', content: 'Summarize this conversation' },
      ],
      schema: SimpleSchema,
      model: 'gemini-1.5-flash',
      temperature: 0.3,
    });

    expect(result.content).toBeDefined();
    expect(result.content).not.toBe('');
    expect(result.content).toMatchObject({
      summary: 'BST implementation discussion',
      topics: ['python', 'data structures'],
      count: 2,
    });
  });

  it('should return raw data when schema validation fails', async () => {
    // This test verifies the fix - returns raw data instead of empty string
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'respond_with_structured_output',
                  args: {
                    // Invalid data that doesn't match schema
                    invalidField: 'this should not be here',
                    someOtherField: 123,
                  },
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Summarize this' }],
      schema: ComplexSchema,
      model: 'gemini-1.5-flash',
    });

    // After fix: returns the raw data instead of empty string
    expect(result.content).not.toBe('');
    expect(result.content).toEqual({
      invalidField: 'this should not be here',
      someOtherField: 123,
    });
    expect(result.usage.outputTokens).toBe(50);
  });

  it('should handle partial matches in complex schemas', async () => {
    // Test that partial data is still returned when some fields are missing
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'respond_with_structured_output',
                  args: {
                    briefSummary: 'Partial response',
                    mainTopics: ['topic1'],
                    // Missing required fields like userQuestions, keyInformation, etc
                  },
                },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 30,
        totalTokenCount: 130,
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Summarize this' }],
      schema: ComplexSchema,
      model: 'gemini-1.5-flash',
    });

    // Should return the partial data instead of empty string
    expect(result.content).not.toBe('');
    expect(result.content).toEqual({
      briefSummary: 'Partial response',
      mainTopics: ['topic1'],
    });
  });
});
