#!/usr/bin/env bun

import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from '../src/client';
import { writeFileSync } from 'fs';
import { join } from 'path';

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
  createClient: (apiKey: string) => { listModels: () => Promise<any[]> },
  apiKeyEnvVar: string,
): Promise<ProviderModels> {
  const apiKey = process.env[apiKeyEnvVar];

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

function generateTypeDefinitions(results: ProviderModels[]): string {
  const header = `/**
 * Auto-generated model types
 * Generated on: ${new Date().toISOString()}
 * 
 * DO NOT EDIT MANUALLY
 * Run 'bun run generate-model-types' to update
 */

`;

  const typeDefinitions = results
    .map((result) => {
      if (result.error || result.models.length === 0) {
        // Generate a comment explaining why no types were generated
        return `// ${result.provider}: ${result.error || 'No models found'}\nexport type ${capitalizeFirst(result.provider)}Model = string;\n`;
      }

      const typeName = `${capitalizeFirst(result.provider)}Model`;
      const modelIds = result.models.map((m) => `  | '${m.id}'`).join('\n');

      return `export type ${typeName} =\n${modelIds};\n`;
    })
    .join('\n');

  // Also generate a union type of all models
  const allProvidersType = `export type AllProviderModels = ${results
    .map((r) => `${capitalizeFirst(r.provider)}Model`)
    .join(' | ')};\n`;

  // Generate model constants for runtime validation
  const modelConstants = results
    .map((result) => {
      if (result.error || result.models.length === 0) {
        return `export const ${result.provider.toUpperCase()}_MODELS: readonly string[] = [];`;
      }

      const constName = `${result.provider.toUpperCase()}_MODELS`;
      const modelIds = result.models.map((m) => `  '${m.id}'`).join(',\n');

      return `export const ${constName} = [\n${modelIds}\n] as const;`;
    })
    .join('\n\n');

  return header + typeDefinitions + '\n' + allProvidersType + '\n' + modelConstants;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function main() {
  console.log('Fetching models from providers...');

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

  // Log results summary
  results.forEach((result) => {
    if (result.error) {
      console.log(`❌ ${result.provider}: ${result.error}`);
    } else {
      console.log(`✅ ${result.provider}: Found ${result.models.length} models`);
    }
  });

  // Generate TypeScript definitions
  const typeDefinitions = generateTypeDefinitions(results);

  // Write to file
  const outputPath = join(process.cwd(), 'src', 'generated', 'model-types.ts');
  writeFileSync(outputPath, typeDefinitions);

  console.log(`\n📝 Generated type definitions at: ${outputPath}`);

  // Also output JSON for reference
  const jsonOutput = results.reduce(
    (acc, result) => {
      acc[result.provider] = result.error
        ? { error: result.error }
        : result.models.map((m) => m.id);
      return acc;
    },
    {} as Record<string, any>,
  );

  const jsonPath = join(process.cwd(), 'src', 'generated', 'models.json');
  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`📋 Generated model list at: ${jsonPath}`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
