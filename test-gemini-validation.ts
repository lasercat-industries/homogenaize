#!/usr/bin/env bun

import { z, ZodError } from 'zod';
import { GeminiProvider } from './src/providers/gemini/gemini';

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

// Test various data patterns that might come from Gemini
const testCases = [
  {
    name: 'Valid complete data',
    data: {
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
  {
    name: 'Missing optional field',
    data: {
      briefSummary: 'Discussion about BST implementation',
      mainTopics: ['data structures', 'python', 'trees'],
      userQuestions: [
        {
          question: 'How to implement BST in Python?',
          answered: true,
          // answerSummary is optional, so this should be valid
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
  {
    name: 'Empty arrays',
    data: {
      briefSummary: 'Brief summary',
      mainTopics: [],
      userQuestions: [],
      keyInformation: [],
      resolution: 'unresolved',
      tags: [],
    },
  },
  {
    name: 'Wrong enum value',
    data: {
      briefSummary: 'Brief summary',
      mainTopics: ['topic'],
      userQuestions: [],
      keyInformation: [],
      resolution: 'invalid_value', // This should fail
      tags: [],
    },
  },
  {
    name: 'Missing required field',
    data: {
      // Missing briefSummary
      mainTopics: ['topic'],
      userQuestions: [],
      keyInformation: [],
      resolution: 'fully_resolved',
      tags: [],
    },
  },
  {
    name: 'Wrong type for boolean',
    data: {
      briefSummary: 'Summary',
      mainTopics: ['topic'],
      userQuestions: [
        {
          question: 'Question?',
          answered: 'yes', // Should be boolean
          answerSummary: 'Answer',
        },
      ],
      keyInformation: [],
      resolution: 'fully_resolved',
      tags: [],
    },
  },
  {
    name: 'Nested object with extra fields',
    data: {
      briefSummary: 'Summary',
      mainTopics: ['topic'],
      userQuestions: [
        {
          question: 'Question?',
          answered: true,
          answerSummary: 'Answer',
          extraField: 'Should not be here', // Extra field
        },
      ],
      keyInformation: [],
      resolution: 'fully_resolved',
      tags: [],
    },
  },
];

console.log('Testing Zod validation with various data patterns:\n');

for (const testCase of testCases) {
  console.log(`\n=== ${testCase.name} ===`);
  console.log('Data:', JSON.stringify(testCase.data, null, 2));

  try {
    const result = ComplexSchema.parse(testCase.data);
    console.log('✅ VALID - Parsed successfully');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof ZodError) {
      console.log('❌ INVALID - Validation failed');
      console.log('Errors:');
      for (const issue of error.issues) {
        console.log(`  - Path: ${issue.path.join('.')}`);
        console.log(`    Message: ${issue.message}`);
        console.log(`    Code: ${issue.code}`);
      }
    } else {
      console.log('❌ ERROR:', error);
    }
  }
}

// Now test what Gemini might actually return
console.log('\n\n=== Testing Gemini-style responses ===\n');

// Simulate what Gemini might return with extra fields or slightly different structure
const geminiStyleResponses = [
  {
    name: 'Gemini response with all fields',
    data: {
      briefSummary: 'The conversation discusses implementing a Binary Search Tree (BST) in Python',
      mainTopics: ['data structures', 'python programming', 'binary search trees'],
      userQuestions: [
        {
          question: 'How to implement BST in Python?',
          answered: true,
          answerSummary:
            'Use a Node class with value, left, and right properties, and implement insert method recursively',
        },
      ],
      keyInformation: [
        {
          topic: 'BST Node Structure',
          details: 'A Node class with value, left child, and right child properties',
        },
        {
          topic: 'Insert Method',
          details: 'Recursive method that places new values based on comparison with current node',
        },
      ],
      resolution: 'fully_resolved',
      tags: ['python', 'data-structures', 'bst', 'algorithms', 'programming'],
    },
  },
  {
    name: 'Gemini response with null in optional field',
    data: {
      briefSummary: 'Quick question about BST',
      mainTopics: ['bst'],
      userQuestions: [
        {
          question: 'How to implement BST?',
          answered: false,
          answerSummary: null, // Gemini might return null for optional fields
        },
      ],
      keyInformation: [],
      resolution: 'unresolved',
      tags: [],
    },
  },
];

for (const testCase of geminiStyleResponses) {
  console.log(`\n=== ${testCase.name} ===`);
  console.log('Data:', JSON.stringify(testCase.data, null, 2));

  try {
    const result = ComplexSchema.parse(testCase.data);
    console.log('✅ VALID - Parsed successfully');
  } catch (error) {
    if (error instanceof ZodError) {
      console.log('❌ INVALID - Validation failed');
      console.log('Errors:');
      for (const issue of error.issues) {
        console.log(`  - Path: ${issue.path.join('.')}`);
        console.log(`    Message: ${issue.message}`);
        console.log(`    Code: ${issue.code}`);
        if (issue.expected !== undefined) {
          console.log(`    Expected: ${issue.expected}`);
        }
        if (issue.received !== undefined) {
          console.log(`    Received: ${issue.received}`);
        }
      }
    }
  }
}
