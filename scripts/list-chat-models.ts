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

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      const client = createOpenAILLM({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4' });
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
  if (process.env.ANTHROPIC_API_KEY) {
    console.log(process.env.ANTHROPIC_API_KEY);
    try {
      const client = createAnthropicLLM({
        apiKey: process.env.ANTHROPIC_API_KEY,
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
  if (process.env.GEMINI_API_KEY) {
    try {
      const client = createGeminiLLM({
        apiKey: process.env.GEMINI_API_KEY,
        model: 'gemini-1.5-pro',
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
