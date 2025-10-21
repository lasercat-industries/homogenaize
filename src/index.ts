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
  type ToolResult,
  type BaseChatOptions,
  type ChatOptions,
  type StreamOptions,
  type DefineToolOptions,
  type ExecuteToolsOptions,
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
  ProviderCapabilities,
} from './providers/provider';

// Provider type exports
export type {
  ProviderName,
  ProviderChatRequest,
  ProviderChatResponse,
  OpenAIChatRequest,
  AnthropicChatRequest,
  GeminiChatRequest,
  OpenAIChatResponse,
  AnthropicChatResponse,
  GeminiChatResponse,
  TypedProvider,
  ModelsForProvider,
} from './providers/types';

// Type guard exports
export { isOpenAIResponse, isAnthropicResponse, isGeminiResponse } from './providers/types';

// Model type exports
export type {
  OpenaiModel,
  AnthropicModel,
  GeminiModel,
  AllProviderModels,
} from './generated/model-types';

export {
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
  isOpenAIModel,
  isAnthropicModel,
  isGeminiModel,
} from './generated/model-types';

// Generic client exports (without provider type parameters)
export {
  createGenericLLM,
  createGenericOpenAI,
  createGenericAnthropic,
  createGenericGemini,
  type GenericLLMClient,
  type GenericLLMConfig,
  type GenericToolConfig,
  type GenericExecutableTool,
  type GenericToolResult,
  type GenericChatOptions,
  type GenericStreamOptions,
  type GenericDefineToolOptions,
  type GenericExecuteToolsOptions,
  type GenericChatResponse,
} from './generic-client';

// Export retry configuration
export type { RetryConfig } from './retry/types';
