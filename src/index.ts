// Main client exports
export {
  createLLM,
  createOpenAILLM,
  createAnthropicLLM,
  createGeminiLLM,
  type LLMClient,
  type LLMConfig,
  type ToolConfig,
  type ExecutableTool,
  type ToolResult
} from './client';

// Provider exports
export type {
  Provider,
  Message,
  MessageRole,
  TextContent,
  MultiModalContent,
  Tool,
  ToolCall,
  ChatRequest,
  ChatResponse,
  StreamingResponse,
  Usage,
  ProviderCapabilities
} from './providers/provider';

// Provider type exports
export type {
  ProviderName,
  ProviderFeatures,
  ProviderResponses,
  ProviderChatRequest,
  ProviderChatResponse,
  TypedProvider
} from './providers/types';

// Type guard exports
export {
  isOpenAIResponse,
  isAnthropicResponse,
  isGeminiResponse
} from './providers/types';

// Re-export zod for convenience
export { z } from 'zod';