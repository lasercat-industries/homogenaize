// Main entry point for the homogenaize library
export {
  // Main client creation functions
  createLLM,
  createOpenAILLM,
  createAnthropicLLM,
  createGeminiLLM,
  
  // Types
  type LLMClient,
  type LLMConfig,
  type ToolConfig,
  type ExecutableTool,
  type ToolResult
} from './src/client';

// Export provider types
export type {
  Provider,
  ChatRequest,
  ChatResponse,
  StreamingResponse,
  Message,
  Tool,
  ToolCall,
  ProviderCapabilities
} from './src/providers/provider';

// Export provider-specific types
export type {
  ProviderName,
  ProviderChatRequest,
  ProviderChatResponse,
  TypedProvider
} from './src/providers/types';

// Re-export zod for convenience
export { z } from 'zod';