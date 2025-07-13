import { z } from 'zod';
import type { 
  StreamingResponse,
  ProviderCapabilities,
  ToolCall,
  Message
} from '../provider';
import type { 
  TypedProvider, 
  ProviderChatRequest, 
  ProviderChatResponse 
} from '../types';

// Anthropic-specific types
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

type AnthropicContent = 
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'thinking'; text: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: any;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  max_thinking_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContent[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    thinking_tokens?: number;
  };
}

// Streaming event types
interface MessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: [];
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

// Helper to convert Zod schema to Anthropic-compatible JSON Schema
function zodToAnthropicSchema(schema: z.ZodSchema): any {
  const zodType = schema._def;
  
  function processZodType(def: any): any {
    switch (def.type) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'array':
        return {
          type: 'array',
          items: processZodType(def.valueType._def)
        };
      case 'object':
        const properties: any = {};
        const required: string[] = [];
        
        // Access shape directly from def
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          const fieldSchema = processZodType((value as any)._def);
          properties[key] = fieldSchema;
          
          // Check if field is optional
          if ((value as any)._def.type !== 'optional') {
            required.push(key);
          }
        }
        
        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined
        };
      case 'optional':
        return processZodType(def.innerType._def);
      case 'enum':
        return {
          type: 'string',
          enum: def.values
        };
      case 'literal':
        return {
          type: typeof def.value,
          const: def.value
        };
      default:
        // Fallback for unsupported types
        return { type: 'string' };
    }
  }
  
  return processZodType(zodType);
}

export class AnthropicProvider implements TypedProvider<'anthropic'> {
  readonly name = 'anthropic' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 200000 // Claude 3 supports up to 200k tokens
  };

  private apiKey: string;
  private baseURL = 'https://api.anthropic.com/v1';
  private apiVersion = '2023-06-01';

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    }
  }

  async chat<T = string>(request: ProviderChatRequest<'anthropic'>): Promise<ProviderChatResponse<'anthropic', T>> {
    const anthropicRequest = this.transformRequest(request);
    
    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(anthropicRequest)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } })) as { error?: { message?: string } };
      throw new Error(`Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json() as AnthropicResponse;
    return this.transformResponse<T>(data, request.schema);
  }

  async stream<T = string>(request: ProviderChatRequest<'anthropic'>): Promise<StreamingResponse<T>> {
    const anthropicRequest = this.transformRequest(request);
    anthropicRequest.stream = true;

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(anthropicRequest)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } })) as { error?: { message?: string } };
      throw new Error(`Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage = { input_tokens: 0, output_tokens: 0 };
    let model = '';
    let finishReason: any;
    // let messageId = ''; // Not needed since id is not part of response type

    const streamResponse = {
      async *[Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              // We don't need the event type for now
              continue;
            }
            
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (!data || data === '[DONE]') continue;
              
              try {
                const event = JSON.parse(data);
                
                switch (event.type) {
                  case 'message_start':
                    const msgStart = event as MessageStartEvent;
                    // messageId = msgStart.message.id;
                    model = msgStart.message.model;
                    usage.input_tokens = msgStart.message.usage.input_tokens;
                    break;
                    
                  case 'content_block_delta':
                    const delta = event as ContentBlockDeltaEvent;
                    if (delta.delta.type === 'text_delta') {
                      const text = delta.delta.text;
                      content += text;
                      // For structured output, we can't yield partial JSON
                      if (!request.schema) {
                        yield text as T;
                      }
                    }
                    break;
                    
                  case 'message_delta':
                    const msgDelta = event as MessageDeltaEvent;
                    usage.output_tokens = msgDelta.usage.output_tokens;
                    finishReason = msgDelta.delta.stop_reason;
                    break;
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
          }
        }
      },

      async complete(): Promise<ProviderChatResponse<'anthropic', T>> {
        // Drain any remaining content
        for await (const _ of streamResponse) {
          // Just consume
        }

        let parsedContent: T;
        if (request.schema && content) {
          try {
            const parsed = JSON.parse(content);
            parsedContent = request.schema.parse(parsed) as T;
          } catch {
            parsedContent = content as T;
          }
        } else {
          parsedContent = content as T;
        }

        return {
          content: parsedContent,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens
          },
          model,
          finishReason,
          // id: messageId // Not part of the response type
        };
      }
    };
    
    return streamResponse;
  }

  supportsFeature(feature: string): boolean {
    return feature in this.capabilities && (this.capabilities as any)[feature] === true;
  }

  private transformRequest(request: ProviderChatRequest<'anthropic'>): AnthropicRequest {
    // Extract system message if present
    let system: string | undefined;
    const messages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        system = typeof msg.content === 'string' ? msg.content : '';
      } else {
        messages.push(this.transformMessage(msg));
      }
    }

    // Handle structured output via schema
    if (request.schema) {
      // Add system prompt for JSON output
      const jsonInstruction = 'You must respond with valid JSON that matches the following schema: ' + 
        JSON.stringify(zodToAnthropicSchema(request.schema));
      system = system ? `${system}\n\n${jsonInstruction}` : jsonInstruction;
    }

    const anthropicRequest: AnthropicRequest = {
      model: request.model || 'claude-3-opus-20240229', // Default fallback
      messages,
      system,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature,
    };

    // Handle Anthropic-specific features
    if (request.features) {
      if (request.features.thinking && request.features.maxThinkingTokens) {
        anthropicRequest.max_thinking_tokens = request.features.maxThinkingTokens;
      }
      // cacheControl would be handled here when implemented
    }

    // Handle tools
    if (request.tools) {
      anthropicRequest.tools = request.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters ? zodToAnthropicSchema(tool.parameters) : { type: 'object', properties: {} }
      }));
    }

    // Handle tool choice
    if (request.toolChoice) {
      if (request.toolChoice === 'required') {
        anthropicRequest.tool_choice = { type: 'any' };
      } else if (request.toolChoice === 'none') {
        // Don't include tools if none
        delete anthropicRequest.tools;
      } else if (request.toolChoice === 'auto') {
        anthropicRequest.tool_choice = { type: 'auto' };
      } else if (typeof request.toolChoice === 'object' && 'name' in request.toolChoice) {
        anthropicRequest.tool_choice = {
          type: 'tool',
          name: request.toolChoice.name
        };
      }
    }

    return anthropicRequest;
  }

  private transformMessage(message: Message): AnthropicMessage {
    if (typeof message.content === 'string') {
      return {
        role: message.role as 'user' | 'assistant',
        content: message.content
      };
    }

    // Handle multi-modal content
    const anthropicContent: AnthropicContent[] = message.content.map(c => {
      if (c.type === 'text') {
        return { type: 'text' as const, text: c.text || '' };
      }
      // Handle image content if needed
      return { type: 'text' as const, text: '[Image content]' };
    });

    return {
      role: message.role as 'user' | 'assistant',
      content: anthropicContent
    };
  }

  private transformResponse<T>(response: AnthropicResponse, schema?: z.ZodSchema): ProviderChatResponse<'anthropic', T> {
    let content = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];

    // Process content blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'thinking') {
        thinking += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input
        });
      }
    }

    let parsedContent: T;
    if (schema && content) {
      try {
        const parsed = JSON.parse(content);
        parsedContent = schema.parse(parsed) as T;
      } catch {
        parsedContent = content as T;
      }
    } else {
      parsedContent = content as T;
    }

    const totalTokens = response.usage.input_tokens + 
                       response.usage.output_tokens + 
                       (response.usage.thinking_tokens || 0);

    const result: ProviderChatResponse<'anthropic', T> = {
      content: parsedContent,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: totalTokens
      },
      model: response.model,
      finishReason: response.stop_reason as any
      // id: response.id // Not part of the response type
    };

    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    if (thinking) {
      result.thinking = thinking;
    }

    return result;
  }
}