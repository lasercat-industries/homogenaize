#!/usr/bin/env bun

import { z } from 'zod';

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

// What Gemini ACTUALLY might return based on real-world usage
const geminiRealWorldResponses = [
  {
    name: 'Gemini returns undefined for arrays instead of empty arrays',
    description: 'Gemini might omit array fields entirely when they should be empty',
    data: {
      briefSummary: 'User asked about BST implementation',
      mainTopics: ['python', 'data structures'],
      // Gemini might omit these fields entirely
      // userQuestions: undefined,
      // keyInformation: undefined,
      resolution: 'fully_resolved',
      // tags: undefined
    },
  },
  {
    name: 'Gemini returns null for optional fields',
    description: 'Gemini returns null instead of omitting optional fields',
    data: {
      briefSummary: 'BST discussion',
      mainTopics: ['programming'],
      userQuestions: [
        {
          question: 'How to implement BST?',
          answered: true,
          answerSummary: null, // null instead of undefined
        },
      ],
      keyInformation: [],
      resolution: 'fully_resolved',
      tags: [],
    },
  },
  {
    name: 'Gemini returns string "true"/"false" for booleans',
    description: 'Type coercion issues',
    data: {
      briefSummary: 'BST discussion',
      mainTopics: ['programming'],
      userQuestions: [
        {
          question: 'How to implement BST?',
          answered: 'true', // String instead of boolean
          answerSummary: 'Use Node class',
        },
      ],
      keyInformation: [],
      resolution: 'fully_resolved',
      tags: [],
    },
  },
  {
    name: 'Gemini returns similar but not exact enum values',
    description: 'Enum values might be close but not exact',
    data: {
      briefSummary: 'BST discussion',
      mainTopics: ['programming'],
      userQuestions: [],
      keyInformation: [],
      resolution: 'resolved', // Instead of 'fully_resolved'
      tags: [],
    },
  },
  {
    name: 'Gemini nests the response in an extra wrapper',
    description: 'Response might be wrapped in additional structure',
    data: {
      response: {
        // Extra wrapper
        briefSummary: 'BST discussion',
        mainTopics: ['programming'],
        userQuestions: [],
        keyInformation: [],
        resolution: 'fully_resolved',
        tags: [],
      },
    },
  },
];

console.log('Testing real-world Gemini response patterns:\n');

for (const testCase of geminiRealWorldResponses) {
  console.log(`\n=== ${testCase.name} ===`);
  console.log(`Description: ${testCase.description}`);
  console.log('Data:', JSON.stringify(testCase.data, null, 2));

  try {
    const result = ComplexSchema.parse(testCase.data);
    console.log('✅ VALID - Parsed successfully');
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.log('❌ INVALID - Validation failed');
      console.log('\nDetailed errors:');
      for (const issue of error.issues) {
        console.log(`  Field: ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}`);
        console.log(`    Problem: ${issue.message}`);
        if (issue.code === 'invalid_type') {
          console.log(`    Expected: ${issue.expected}`);
          console.log(`    Received: ${issue.received}`);
        } else if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_value') {
          console.log(`    Valid options: ${(issue as any).options?.join(', ') || 'see schema'}`);
          console.log(`    Received: "${(issue as any).received || testCase.data}"`);
        }
      }

      // Show what fields are missing
      const requiredFields = [
        'briefSummary',
        'mainTopics',
        'userQuestions',
        'keyInformation',
        'resolution',
        'tags',
      ];
      const providedFields = Object.keys(testCase.data);
      const missingFields = requiredFields.filter((f) => !providedFields.includes(f));
      if (missingFields.length > 0) {
        console.log(`\n  Missing required fields: ${missingFields.join(', ')}`);
      }
    }
  }
}

// Test the actual JSON that Gemini's tool call might return
console.log('\n\n=== Simulating actual Gemini tool call response ===\n');

const simulatedGeminiToolCall = {
  name: 'respond_with_structured_output',
  args: {
    // Gemini might generate this based on the schema but miss some fields
    briefSummary:
      'The user asked how to implement a Binary Search Tree in Python and received a concise answer.',
    mainTopics: ['Binary Search Trees', 'Python Programming', 'Data Structures'],
    userQuestions: [
      {
        question: 'How to implement BST in Python?',
        answered: true,
        // Note: answerSummary is optional and omitted
      },
    ],
    // Gemini might skip empty arrays entirely
    keyInformation: [
      {
        topic: 'Implementation',
        details: 'Use a Node class with insert method',
      },
    ],
    resolution: 'fully_resolved',
    tags: ['python', 'bst'],
  },
};

console.log('Simulated Gemini tool call:', JSON.stringify(simulatedGeminiToolCall, null, 2));

try {
  const result = ComplexSchema.parse(simulatedGeminiToolCall.args);
  console.log('\n✅ Tool call arguments are VALID');
  console.log('Parsed result:', JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof z.ZodError) {
    console.log('\n❌ Tool call arguments are INVALID');
    console.log('Validation errors:', error.issues);
  }
}
