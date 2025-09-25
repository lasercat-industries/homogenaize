#!/usr/bin/env bun

import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from '../src/client';
import type { ModelInfo } from '../src/providers/provider';

interface ProviderModels {
  provider: string;
  models: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  error?: string;
}

async function listModelsForProvider(
  provider: string,
  createClient: (apiKey: string) => { listModels: () => Promise<ModelInfo[]> },
  apiKeyEnvVar: string,
): Promise<ProviderModels> {
  const apiKey =
    process !== undefined
      ? process.env[apiKeyEnvVar]
      : import.meta.env[apiKeyEnvVar] || import.meta.env[`VITE_${apiKeyEnvVar}`];

  if (!apiKey) {
    return {
      provider,
      models: [],
      error: `No API key found. Set ${apiKeyEnvVar} environment variable.`,
    };
  }

  try {
    const client = createClient(apiKey);
    const models = await client.listModels();
    return {
      provider,
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
      })),
    };
  } catch (error) {
    return {
      provider,
      models: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function main() {
  const results = await Promise.all([
    listModelsForProvider(
      'openai',
      (apiKey) => createOpenAILLM({ apiKey, model: 'gpt-4' }),
      'OPENAI_API_KEY',
    ),
    listModelsForProvider(
      'anthropic',
      (apiKey) => createAnthropicLLM({ apiKey, model: 'claude-3-opus-20240229' }),
      'ANTHROPIC_API_KEY',
    ),
    listModelsForProvider(
      'gemini',
      (apiKey) => createGeminiLLM({ apiKey, model: 'gemini-1.5-pro' }),
      'GEMINI_API_KEY',
    ),
  ]);

  // Create a single object with all providers
  const output = results.reduce(
    (acc, result) => {
      acc[result.provider] = result.error ? { error: result.error } : result.models;
      return acc;
    },
    {} as Record<string, { error: string } | ModelInfo[]>,
  );

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
