#!/usr/bin/env bun

import { createOpenAILLM, createAnthropicLLM, createGeminiLLM } from '../src/client';

// Known chat model patterns
const CHAT_MODEL_PATTERNS = {
  openai: /^(gpt-|o1-|o3-|o4-|chatgpt)/i,
  anthropic: /^claude/i,
  gemini: /^gemini/i,
};

async function listChatModels() {
  const results: Record<string, string[]> = {};

  const openAiKey =
    process !== undefined
      ? process.env.OPENAI_API_KEY
      : import.meta.env.OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY;
  const anthropicKey =
    process !== undefined
      ? process.env.ANTHROPIC_API_KEY
      : import.meta.env.ANTHROPIC_API_KEY || import.meta.env.VITE_ANTHROPIC_API_KEY;
  const geminiKey =
    process !== undefined
      ? process.env.GEMINI_API_KEY
      : import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;

  // OpenAI
  if (openAiKey) {
    try {
      const client = createOpenAILLM({ apiKey: openAiKey, model: 'gpt-4' });
      const models = await client.listModels();
      results.openai = models
        .filter((m) => CHAT_MODEL_PATTERNS.openai.test(m.id))
        .map((m) => m.id)
        .sort();
    } catch (error) {
      results.openai = [`Error: ${error instanceof Error ? error.message : 'Unknown'}`];
    }
  } else {
    results.openai = ['No API key (set OPENAI_API_KEY)'];
  }

  // Anthropic
  if (anthropicKey) {
    try {
      const client = createAnthropicLLM({
        apiKey: anthropicKey,
        model: 'claude-3-opus-20240229',
      });
      const models = await client.listModels();
      results.anthropic = models
        .filter((m) => CHAT_MODEL_PATTERNS.anthropic.test(m.id))
        .map((m) => m.id)
        .sort();
    } catch (error) {
      results.anthropic = [`Error: ${error instanceof Error ? error.message : 'Unknown'}`];
    }
  } else {
    results.anthropic = ['No API key (set ANTHROPIC_API_KEY)'];
  }

  // Gemini
  if (geminiKey) {
    try {
      const client = createGeminiLLM({
        apiKey: geminiKey,
        model: 'gemini-2.5-flash',
      });
      const models = await client.listModels();
      results.gemini = models
        .filter((m) => CHAT_MODEL_PATTERNS.gemini.test(m.id))
        .map((m) => m.id)
        .sort();
    } catch (error) {
      results.gemini = [`Error: ${error instanceof Error ? error.message : 'Unknown'}`];
    }
  } else {
    results.gemini = ['No API key (set GEMINI_API_KEY)'];
  }

  console.log(JSON.stringify(results, null, 2));
}

listChatModels().catch(console.error);
