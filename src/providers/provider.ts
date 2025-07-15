import { z } from 'zod';
import type { ModelInfo } from './types';

// Base message types
export type MessageRole = 'user' | 'assistant' | 'system';

export type TextContent = string;

export interface MultiModalContent {
  type: 'text' | 'image';
  text?: string;
  url?: string;
  mimeType?: string;
}

export interface Message {
  role: MessageRole;
  content: TextContent | MultiModalContent[];
}

// Tool types
export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

// Request types
export interface ChatRequest {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  schema?: z.ZodSchema;
  tools?: Tool[];
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };
}

// Response types
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatResponse<T = string> {
  content: T;
  usage: Usage;
  model: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  toolCalls?: ToolCall[];
}

// Streaming types
export interface StreamingResponse<T = string> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
  complete(): Promise<ChatResponse<T>>;
}

// Provider capabilities
export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  structuredOutput: boolean;
  vision: boolean;
  maxTokens: number;
}

// Main provider interface
export interface Provider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  chat<T = string>(request: ChatRequest): Promise<ChatResponse<T>>;
  stream<T = string>(request: ChatRequest): Promise<StreamingResponse<T>>;
  supportsFeature(feature: string): boolean;
  listModels(): Promise<ModelInfo[]>;
}
