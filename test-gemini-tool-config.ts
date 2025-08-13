#!/usr/bin/env bun

import { GeminiProvider } from './src/providers/gemini/gemini';
import { z } from 'zod';

// Simple mock for fetch
let fetchCalls: any[] = [];
let mockResponses: any[] = [];

global.fetch = (async (...args: any[]) => {
  fetchCalls.push(args);
  const response = mockResponses.shift();
  return {
    ok: true,
    json: async () => response,
  };
}) as any;

const provider = new GeminiProvider('test-api-key');

const TestSchema = z.object({
  summary: z.string(),
  topics: z.array(z.string()),
});

// Test 1: Verify toolConfig is set correctly when using schema
console.log('=== Test 1: Schema-only request ===\n');

mockResponses.push({
  candidates: [
    {
      content: {
        parts: [
          {
            functionCall: {
              name: 'respond_with_structured_output',
              args: {
                summary: 'Test summary',
                topics: ['topic1', 'topic2'],
              },
            },
          },
        ],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    totalTokenCount: 30,
  },
});

await provider.chat({
  messages: [{ role: 'user', content: 'Test message' }],
  schema: TestSchema,
  model: 'gemini-1.5-flash',
});

const call1 = JSON.parse(fetchCalls[0][1].body);
console.log('Request body for schema-only call:');
console.log('Tools:', JSON.stringify(call1.tools, null, 2));
console.log('Tool Config:', JSON.stringify(call1.toolConfig, null, 2));

// Verify the tool config
if (call1.toolConfig?.functionCallingConfig?.mode === 'ANY') {
  console.log('✅ CORRECT: mode is set to ANY (forces function call)');
} else {
  console.log('❌ INCORRECT: mode is not ANY, function call may not be forced');
  console.log('Actual mode:', call1.toolConfig?.functionCallingConfig?.mode);
}

// Test 2: Verify toolConfig when using explicit tools with toolChoice
console.log('\n=== Test 2: Explicit tools with toolChoice="required" ===\n');

mockResponses.push({
  candidates: [
    {
      content: {
        parts: [
          {
            functionCall: {
              name: 'custom_tool',
              args: { param: 'test' },
            },
          },
        ],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    totalTokenCount: 30,
  },
});

await provider.chat({
  messages: [{ role: 'user', content: 'Test message' }],
  tools: [
    {
      name: 'custom_tool',
      description: 'A custom tool',
      parameters: z.object({ param: z.string() }),
    },
  ],
  toolChoice: 'required',
  model: 'gemini-1.5-flash',
});

const call2 = JSON.parse(fetchCalls[1][1].body);
console.log('Request body for explicit tools with toolChoice="required":');
console.log('Tool Config:', JSON.stringify(call2.toolConfig, null, 2));

if (call2.toolConfig?.functionCallingConfig?.mode === 'ANY') {
  console.log('✅ CORRECT: mode is ANY for toolChoice="required" (forces function call)');
} else {
  console.log('Mode:', call2.toolConfig?.functionCallingConfig?.mode || 'not set');
}

// Test 3: Check what happens with schema AND tools (should not add hidden tool)
console.log('\n=== Test 3: Schema with explicit tools ===\n');

mockResponses.push({
  candidates: [
    {
      content: {
        parts: [{ text: 'Response' }],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    totalTokenCount: 30,
  },
});

await provider.chat({
  messages: [{ role: 'user', content: 'Test message' }],
  schema: TestSchema,
  tools: [
    {
      name: 'custom_tool',
      description: 'A custom tool',
      parameters: z.object({ param: z.string() }),
    },
  ],
  model: 'gemini-1.5-flash',
});

const call3 = JSON.parse(fetchCalls[2][1].body);
console.log('Request body for schema + tools:');
console.log('Number of tools:', call3.tools?.[0]?.functionDeclarations?.length || 0);
const toolNames = call3.tools?.[0]?.functionDeclarations?.map((t: any) => t.name) || [];
console.log('Tool names:', toolNames);

if (!toolNames.includes('respond_with_structured_output')) {
  console.log(
    '✅ CORRECT: Hidden structured output tool not added when explicit tools are present',
  );
} else {
  console.log('❌ INCORRECT: Hidden tool was added even with explicit tools');
}

// Test 4: Verify we're sending the right structure to Gemini API
console.log('\n=== Test 4: Verify Gemini API request structure ===\n');

console.log('Full request structure for schema-only call:');
console.log('URL:', fetchCalls[0][0]);
console.log('Method:', fetchCalls[0][1].method);
console.log('Headers:', fetchCalls[0][1].headers);

const fullBody = JSON.parse(fetchCalls[0][1].body);
console.log('\nVerifying critical fields:');
console.log('- Has tools array:', Array.isArray(fullBody.tools));
console.log('- Number of tools:', fullBody.tools?.length);
console.log('- Tool name:', fullBody.tools?.[0]?.functionDeclarations?.[0]?.name);
console.log('- Has toolConfig:', !!fullBody.toolConfig);
console.log(
  '- toolConfig.functionCallingConfig.mode:',
  fullBody.toolConfig?.functionCallingConfig?.mode,
);

if (
  fullBody.toolConfig?.functionCallingConfig?.mode === 'ANY' &&
  fullBody.tools?.[0]?.functionDeclarations?.[0]?.name === 'respond_with_structured_output'
) {
  console.log('\n✅ VERIFIED: Schema-only requests correctly force function calling with mode=ANY');
} else {
  console.log('\n❌ PROBLEM: Schema-only requests may not force function calling correctly');
}
